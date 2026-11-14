// Minimal S3-compatible upload for Cloudflare R2: one signed PUT, no SDK.
// R2 speaks the S3 API at https://<ACCOUNT_ID>.r2.cloudflarestorage.com with
// region "auto" and AWS Signature Version 4 (Cloudflare docs, checked
// 2026-11-14). A single PUT may carry up to 5 GiB less 5 MiB.
import { createHash, createHmac } from "node:crypto";

export type S3Target = {
  endpoint: string; // origin only, e.g. https://<account>.r2.cloudflarestorage.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string; // "auto" for R2
};

const sha256Hex = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding as SigV4 requires; "/" stays as the path separator.
export const encodePath = (path: string) =>
  path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
      ),
    )
    .join("/");

export function amzDate(now: Date) {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

// Returns the Authorization header for a request whose path is already
// encoded and whose query string is empty. Every header given is signed.
export function signV4(input: {
  method: string;
  path: string;
  query?: string;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date: string; // YYYYMMDDTHHMMSSZ, equal to the x-amz-date header
}) {
  const names = Object.keys(input.headers)
    .map((n) => n.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const canonical = [
    input.method,
    input.path,
    input.query ?? "",
    names.map((n) => `${n}:${lower[n].trim()}\n`).join(""),
    names.join(";"),
    input.payloadHash,
  ].join("\n");
  const day = input.date.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    input.date,
    scope,
    sha256Hex(canonical),
  ].join("\n");
  let key = hmac("AWS4" + input.secretAccessKey, day);
  key = hmac(key, input.region);
  key = hmac(key, input.service);
  key = hmac(key, "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Create-only PUT (If-None-Match: *): an existing object is never replaced.
export async function putObject(
  target: S3Target,
  key: string,
  body: Uint8Array,
  options: { fetcher?: Fetch; now?: Date; contentType?: string } = {},
) {
  const url = new URL(target.endpoint);
  const path = `/${target.bucket}/${encodePath(key)}`;
  const date = amzDate(options.now ?? new Date());
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: url.host,
    "content-type": options.contentType ?? "application/octet-stream",
    "if-none-match": "*",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
  };
  const authorization = signV4({
    method: "PUT",
    path,
    headers,
    payloadHash,
    accessKeyId: target.accessKeyId,
    secretAccessKey: target.secretAccessKey,
    region: target.region,
    service: "s3",
    date,
  });
  const { host: _host, ...sent } = headers;
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url.origin + path, {
      method: "PUT",
      headers: { ...sent, authorization },
      body: body as Uint8Array<ArrayBuffer>,
      signal: AbortSignal.timeout(30 * 60_000),
    });
  } catch {
    throw Error("UPLOAD_UNREACHABLE");
  }
  if (response.status !== 200) {
    // S3 error bodies are XML with a <Code>; report that code alone.
    const code = /<Code>([A-Za-z]+)<\/Code>/.exec(
      await response.text().catch(() => ""),
    )?.[1];
    throw Error(`UPLOAD_FAILED_${response.status}${code ? "_" + code : ""}`);
  }
  return { etag: response.headers.get("etag") ?? "" };
}
