import "server-only";
import { ZodError } from "zod";
import { AppError } from "../../../packages/contracts/src/index.ts";
import { isHosted } from "../../../packages/contracts/src/hosting.ts";

// Safe codes raised by the billing functions in the database.
const billingErrors: Record<string, number> = {
  TRIAL_USED: 409,
  INVALID_TOPUP: 422,
  TOO_MANY_PENDING: 409,
  APPEND_ONLY: 403,
  INVALID_USAGE: 422,
  UNKNOWN_USAGE_KIND: 422,
};
export function respond(data: unknown, status = 200) {
  return Response.json(
    { ok: true, data, requestId: crypto.randomUUID() },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
export function failure(error: unknown) {
  let status = 500,
    code = "INTERNAL_ERROR";
  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
  } else if (error instanceof ZodError) {
    status = 422;
    code = "VALIDATION_ERROR";
  } else if (
    error instanceof Error &&
    ["CONFLICT", "NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(
      error.message,
    )
  ) {
    code = error.message;
    status = {
      CONFLICT: 409,
      NOT_FOUND: 404,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
    }[code]!;
  } else if (
    error instanceof Error &&
    error.message in billingErrors &&
    ["P0001", "42501"].includes((error as { code?: string }).code ?? "")
  ) {
    code = error.message;
    status = billingErrors[code];
  } else if ((error as { code?: string })?.code === "23P01") {
    status = 409;
    code = "SLOT_UNAVAILABLE";
  } else if ((error as { code?: string })?.code === "23505") {
    status = 409;
    code = "CONFLICT";
  } else if (
    ["ECONNREFUSED", "57P01", "57P03"].includes(
      (error as { code?: string })?.code ?? "",
    )
  ) {
    status = 503;
    code = "DATABASE_UNAVAILABLE";
  }
  return Response.json(
    {
      ok: false,
      error: { code, message: code },
      requestId: crypto.randomUUID(),
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        ...(status === 429 ? { "retry-after": "60" } : {}),
      },
    },
  );
}
export async function readBody(request: Request, limit = 2 * 1024 * 1024) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new AppError("INVALID_JSON", 422);
  }
}
// A binary body (setup upload chunks). Only application/octet-stream is read;
// a declared length over the cap is refused unread, and reading stops at the
// cap, so a larger body is never held in memory. One piece is returned as a
// view; several are joined once.
export async function readRaw(request: Request, limit: number): Promise<Buffer> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/octet-stream"
  )
    throw new AppError("OCTET_STREAM_REQUIRED", 415);
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (declared > limit) {
    await request.body?.cancel();
    throw new AppError("PAYLOAD_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  if (chunks.length === 1)
    return Buffer.from(chunks[0].buffer, chunks[0].byteOffset, chunks[0].byteLength);
  return Buffer.concat(chunks, size);
}
export function cookie(request: Request, key: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(key + "="))
      ?.slice(key.length + 1) ?? ""
  );
}
export function setCookie(
  response: Response,
  key: string,
  value: string,
  maxAge = 3600,
) {
  response.headers.append(
    "set-cookie",
    `${key}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` +
      (isHosted() ? "; Secure" : ""),
  );
}
