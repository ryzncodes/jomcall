import {
  commands,
  type CoreClient,
  type Command,
  type Input,
  type Output,
} from "../../../packages/contracts/src/core.ts";
export class CoreError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
// An error page that did not come from JomCall: a body that is not JSON
// (a proxy's or CDN's HTML 413, 502 or 403 page). Deliberately not a
// CoreError, so every screen treats it as it treated an unreadable answer
// before (the connection sentence, input kept) and it never counts as a
// record that is gone (isResourceUnavailable). errorText words it by status.
export class ProxyError extends Error {
  readonly code = "PROXY";
  constructor(readonly status: number) {
    super("PROXY");
  }
}
// The status and code of a failed request, for rules that decide retries
// and sentences: a JSON error from the app (its code), a proxy's page (code
// "PROXY"), or no answer at all (both null: offline, timeout, aborted).
export function failureOf(error: unknown): {
  status: number | null;
  code: string | null;
} {
  if (error instanceof CoreError)
    return { status: error.status, code: error.code };
  if (error instanceof ProxyError) return { status: error.status, code: "PROXY" };
  return { status: null, code: null };
}
// Only a JSON error from the app itself may say a record is gone.
export function isResourceUnavailable(error: unknown) {
  return (
    error instanceof CoreError &&
    ([401, 403, 404, 410].includes(error.status) ||
      ["DELETION_PENDING", "CONTACT_DELETION_PENDING"].includes(error.code))
  );
}
export class HttpCoreClient implements CoreClient {
  private fetcher: typeof fetch;
  // Retain unresolved operations for explicit retries, scoped to this workspace client.
  private pending = new Map<string, string>();
  constructor(private options: { fetch?: typeof fetch; orgId?: string }) {
    this.fetcher = (options.fetch ?? fetch).bind(undefined);
  }
  async csrf(signal?: AbortSignal) {
    const r = await this.fetcher("/api/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    return (await this.decode(r)).token as string;
  }
  // A body that is not JSON (a proxy's HTML 413 or 502 page) is a
  // ProxyError with that status: never a raw code on screen, never a record
  // that is gone.
  private async decode(r: Response) {
    let value: {
      ok?: boolean;
      data?: any;
      error?: { code?: string };
    } | null;
    try {
      value = await r.json();
    } catch {
      throw new ProxyError(r.status);
    }
    if (!r.ok || !value?.ok)
      throw new CoreError(value?.error?.code ?? "REQUEST_FAILED", r.status);
    return value.data;
  }
  async auth(action: string, body: unknown) {
    const token = await this.csrf();
    return this.decode(
      await this.fetcher("/api/auth/" + action, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify(body),
      }),
    );
  }
  // The command's path with its fields filled in; the fields left over are
  // the query or body.
  private route<K extends Command>(command: K, input: Input<K>) {
    const def = commands[command],
      value = { ...def.input.parse(input) } as Record<string, unknown>;
    const path = def.path.replace(/:([a-zA-Z]+)/g, (_, field: string) => {
      const v = String(value[field]);
      delete value[field];
      return encodeURIComponent(v);
    });
    return { def, path, value };
  }
  private orgHeader(): Record<string, string> {
    return this.options.orgId
      ? { "x-organization-id": this.options.orgId }
      : {};
  }
  async execute<K extends Command>(
    command: K,
    input: Input<K>,
    key?: string,
    // Stops the request (a removed upload, a timed-out try). The operation's
    // idempotency key is kept, so sending it again is safe.
    signal?: AbortSignal,
  ): Promise<Output<K>> {
    const { def, path, value } = this.route(command, input);
    const headers: Record<string, string> = this.orgHeader();
    let url = "/api/v1" + path,
      body: string | undefined;
    const operation =
      def.method !== "GET" && !key
        ? command + ":" + path + ":" + JSON.stringify(value)
        : undefined;
    if (operation && !this.pending.has(operation))
      this.pending.set(operation, crypto.randomUUID());
    if (def.method === "GET") {
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(value))
        if (v !== undefined) query.set(k, String(v));
      if (query.size) url += "?" + query;
    } else {
      headers["content-type"] = "application/json";
      headers["x-csrf-token"] = await this.csrf(signal);
      headers["idempotency-key"] = key ?? this.pending.get(operation!)!;
      body = JSON.stringify(value);
    }
    const result = await this.decode(
      await this.fetcher(url, {
        method: def.method,
        headers,
        body,
        credentials: "same-origin",
        cache: "no-store",
        signal,
      }),
    );
    if (operation && this.pending.get(operation) === headers["idempotency-key"])
      this.pending.delete(operation);
    return result;
  }
  // A setup upload chunk: the body is raw bytes, not JSON. Same CSRF token,
  // organization and idempotency rules as execute. The key belongs to the
  // upload id and seq: a chunk sent again after a failure or a lost answer
  // carries the same key until one send is acknowledged. `signal` stops the
  // send (a removed upload, a timed-out attempt).
  async putChunk(
    input: Input<"putSetupUploadChunk">,
    bytes: Blob,
    signal?: AbortSignal,
  ): Promise<Output<"putSetupUploadChunk">> {
    const { path } = this.route("putSetupUploadChunk", input);
    const operation = "putSetupUploadChunk:" + path;
    if (!this.pending.has(operation))
      this.pending.set(operation, crypto.randomUUID());
    const key = this.pending.get(operation)!;
    const result = await this.decode(
      await this.fetcher("/api/v1" + path, {
        method: "PUT",
        headers: {
          ...this.orgHeader(),
          "content-type": "application/octet-stream",
          "x-csrf-token": await this.csrf(signal),
          "idempotency-key": key,
        },
        body: bytes,
        credentials: "same-origin",
        cache: "no-store",
        signal,
      }),
    );
    if (this.pending.get(operation) === key) this.pending.delete(operation);
    return result;
  }
  // One stored chunk's raw bytes (the review page's preview).
  async getChunk(input: Input<"setupUploadChunk">): Promise<Uint8Array> {
    const { path } = this.route("setupUploadChunk", input);
    const r = await this.fetcher("/api/v1" + path, {
      headers: this.orgHeader(),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!r.ok) {
      await this.decode(r);
      throw new ProxyError(r.status);
    }
    return new Uint8Array(await r.arrayBuffer());
  }
  async download(id: string) {
    const r = await this.fetcher(
      "/api/v1/jobs/" + encodeURIComponent(id) + "/download",
      {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "x-organization-id": this.options.orgId ?? "" },
      },
    );
    if (!r.ok) {
      await this.decode(r);
      throw Error("DOWNLOAD_FAILED");
    }
    return r.blob();
  }
}
type Handlers = { [K in Command]?: (input: Input<K>) => Promise<Output<K>> };
export class MockCoreClient implements CoreClient {
  constructor(private options: { handlers: Handlers }) {}
  async execute<K extends Command>(
    command: K,
    input: Input<K>,
  ): Promise<Output<K>> {
    const handler = this.options.handlers[command] as
      | ((v: Input<K>) => Promise<Output<K>>)
      | undefined;
    if (!handler) throw new CoreError("MOCK_COMMAND_UNAVAILABLE", 503);
    commands[command].input.parse(input);
    return handler(input);
  }
}
