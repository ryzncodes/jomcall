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
  async csrf() {
    const r = await this.fetcher("/api/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return (await this.decode(r)).token as string;
  }
  private async decode(r: Response) {
    const value = await r.json();
    if (!r.ok || !value.ok)
      throw new CoreError(value.error?.code ?? "REQUEST_FAILED", r.status);
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
  async execute<K extends Command>(
    command: K,
    input: Input<K>,
    key?: string,
  ): Promise<Output<K>> {
    const def = commands[command],
      value = { ...def.input.parse(input) } as Record<string, unknown>;
    const path = def.path.replace(/:([a-zA-Z]+)/g, (_, field: string) => {
      const v = String(value[field]);
      delete value[field];
      return encodeURIComponent(v);
    });
    const headers: Record<string, string> = {
      ...(this.options.orgId
        ? { "x-organization-id": this.options.orgId }
        : {}),
    };
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
      headers["x-csrf-token"] = await this.csrf();
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
      }),
    );
    if (operation && this.pending.get(operation) === headers["idempotency-key"])
      this.pending.delete(operation);
    return result;
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
