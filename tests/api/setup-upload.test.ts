import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPhase2Harness } from "../helpers/phase2.ts";
import { setupReader } from "../../packages/inference/src/provider.ts";
import { readRaw } from "../../web/lib/server/http.ts";
import { handleAuth } from "../../web/lib/server/auth.ts";
import { createDispatch } from "../../web/lib/server/api.ts";
import {
  setupUploadCreate,
  UPLOAD_LIMITS,
} from "../../packages/contracts/src/setup-upload.ts";

// The web process only reads the reader switch; no model is called here.
async function withReader<T>(value: string | undefined, run: () => Promise<T>) {
  const prior = process.env.JOMCALL_SETUP_READER;
  if (value === undefined) delete process.env.JOMCALL_SETUP_READER;
  else process.env.JOMCALL_SETUP_READER = value;
  try {
    return await run();
  } finally {
    if (prior === undefined) delete process.env.JOMCALL_SETUP_READER;
    else process.env.JOMCALL_SETUP_READER = prior;
  }
}

const MiB = 1024 * 1024;
const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const fill = (n: number, byte = 0x41) => new Uint8Array(n).fill(byte);
const pdf = (n: number) => cat(enc("%PDF-1.4\n"), fill(n - 9));
const jpeg = cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), fill(60));
const png = cat(
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  fill(60),
);
const webp = cat(enc("RIFF"), new Uint8Array([10, 0, 0, 0]), enc("WEBPVP8 "), fill(40));
const xlsx = cat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), fill(60));

async function fixture() {
  const f = await createPhase2Harness();
  const agentId = f.h.orgA.agentId;
  const base = `/agents/${agentId}/setup`;
  const up = `${base}/uploads`;
  const started = await f.req("POST", base, {
    mainPack: "appointment",
    extraPacks: [],
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  type Actor = typeof f.h.alice;
  const as = (a: Actor = f.h.alice, org = f.h.orgA.id) => ({
    req: (method: string, path: string, body?: unknown) =>
      f.api.request(a, org, method, "/api/v1" + path, body),
    raw: (
      method: string,
      path: string,
      body?: Uint8Array,
      headers: Record<string, string> = {},
    ) => f.api.raw(a, org, method, "/api/v1" + path, body, headers),
  });
  const owner = as();
  const create = (
    body: Record<string, unknown> = {},
    who = owner,
    path = up,
  ) =>
    who.req("POST", path, {
      kind: "pdf",
      name: "senarai-harga.pdf",
      mime: "application/pdf",
      bytes: 300,
      ...body,
    });
  const put = (id: string, seq: number, bytes: Uint8Array, who = owner) =>
    who.raw("PUT", `${up}/${id}/chunks/${seq}`, bytes);
  const finish = (id: string, who = owner) =>
    who.req("POST", `${up}/${id}/finish`, {});
  const remove = (id: string, who = owner) =>
    who.req("DELETE", `${up}/${id}`, {});
  const chunk = (id: string, seq: number, who = owner) =>
    who.raw("GET", `${up}/${id}/chunks/${seq}`);
  const view = async () => (await f.req("GET", base)).body.data;
  const q = (sql: string, args: unknown[] = []) => f.h.cleanup.query(sql, args);
  // Create, send the parts in order and finish.
  const upload = async (
    parts: Uint8Array[],
    body: Record<string, unknown> = {},
  ) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const c = await create({ bytes: total, ...body });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    for (const [i, p] of parts.entries())
      assert.equal((await put(c.body.data.id, i, p)).status, 200);
    return { id: c.body.data.id as string, done: await finish(c.body.data.id) };
  };
  const reads = async (id: string) =>
    Number(
      (
        await q(
          "select count(*) from app.outbox where kind='setup.read' and resource_id=$1",
          [id],
        )
      ).rows[0].count,
    );
  const chunks = async (id: string) =>
    Number(
      (
        await q("select count(*) from app.setup_upload_chunk where upload_id=$1", [
          id,
        ])
      ).rows[0].count,
    );
  const row = async (id: string) =>
    (await q("select * from app.setup_upload where id=$1", [id])).rows[0];
  const sessionId = started.body.data.session.id as string;
  return {
    f,
    agentId,
    base,
    up,
    as,
    owner,
    create,
    put,
    finish,
    remove,
    chunk,
    view,
    q,
    upload,
    reads,
    chunks,
    row,
    sessionId,
  };
}

test("setupReader reads the switch and fails closed on any other value", () => {
  assert.equal(setupReader({}), "disabled");
  assert.equal(setupReader({ JOMCALL_SETUP_READER: "" }), "disabled");
  assert.equal(setupReader({ JOMCALL_SETUP_READER: "disabled" }), "disabled");
  assert.equal(setupReader({ JOMCALL_SETUP_READER: "anthropic" }), "anthropic");
  assert.throws(
    () => setupReader({ JOMCALL_SETUP_READER: "s3cret-looking-value" }),
    (e: Error) =>
      e.message === "SETUP_READER_UNKNOWN: JOMCALL_SETUP_READER" &&
      !e.message.includes("s3cret"),
  );
});

const rawReq = (
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) =>
  new Request("http://127.0.0.1/x", {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
// Pull-only stream (no read-ahead): `pulled` counts the pieces actually read.
function pieces(count: number, size = MiB) {
  const s = { pulled: 0, stream: null as unknown as ReadableStream<Uint8Array> };
  s.stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (s.pulled++ < count) c.enqueue(fill(size));
        else c.close();
      },
    },
    { highWaterMark: 0 },
  );
  return s;
}

test("the raw body reader cuts off a body that streams past the cap without a content-length", async () => {
  const over = pieces(10);
  await assert.rejects(
    readRaw(rawReq(over.stream), 3 * MiB),
    (e: any) => e.code === "PAYLOAD_TOO_LARGE" && e.status === 413,
  );
  // Stopped at the fourth piece, the one that crossed the cap, not at ten.
  assert.equal(over.pulled, 4);
  const fits = pieces(4);
  const out = await readRaw(rawReq(fits.stream), 4 * MiB);
  assert.ok(Buffer.isBuffer(out));
  assert.equal(out.length, 4 * MiB);
  const json = pieces(1);
  await assert.rejects(
    readRaw(rawReq(json.stream, { "content-type": "application/json" }), 4 * MiB),
    (e: any) => e.status === 415,
  );
  assert.equal(json.pulled, 0);
});

test("the raw body reader refuses a content-length over the cap without reading the body", async () => {
  let read = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        read = true;
        throw Error("BODY_READ");
      },
    },
    { highWaterMark: 0 },
  );
  await assert.rejects(
    readRaw(rawReq(stream, { "content-length": String(3 * MiB + 1) }), 3 * MiB),
    (e: any) => e.code === "PAYLOAD_TOO_LARGE" && e.status === 413,
  );
  assert.equal(read, false);
});

test("create, three chunks, finish queues one read", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const parts = [pdf(100), fill(100, 0x42), fill(100, 0x43)];
      const c = await x.create({ name: "harga.pdf", bytes: 300 });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      const id = c.body.data.id;
      assert.equal(c.body.data.state, "uploading");
      // Any order; a re-sent seq replaces the earlier bytes.
      assert.equal((await x.put(id, 2, parts[2])).status, 200);
      assert.equal((await x.put(id, 1, fill(100, 0x5a))).status, 200);
      const p0 = await x.put(id, 0, parts[0]);
      assert.equal(p0.status, 200);
      assert.deepEqual(JSON.parse(Buffer.from(p0.bytes).toString()).data, {
        received: 300,
      });
      // Same idempotency key: replayed; same key with other bytes: conflict.
      const key = randomUUID();
      const path = `${x.up}/${id}/chunks/1`;
      const first = await x.owner.raw("PUT", path, parts[1], {
        "idempotency-key": key,
      });
      assert.equal(first.status, 200);
      const again = await x.owner.raw("PUT", path, parts[1], {
        "idempotency-key": key,
      });
      assert.equal(again.status, 200);
      const other = await x.owner.raw("PUT", path, fill(100, 0x51), {
        "idempotency-key": key,
      });
      assert.equal(other.status, 409);
      assert.equal(await x.reads(id), 0);

      const done = await x.finish(id);
      assert.equal(done.status, 200, JSON.stringify(done.body));
      const u = done.body.data;
      assert.equal(u.state, "queued");
      assert.equal(u.bytes, 300);
      assert.equal(u.kind, "pdf");
      assert.equal(u.failCode, null);
      assert.deepEqual(
        Object.keys(u).sort(),
        ["bytes", "bytesDeletedAt", "createdAt", "droppedCount", "factCount", "failCode", "id", "kind", "name", "rowCount", "state"],
      );
      assert.equal(await x.reads(id), 1);
      const r = await x.row(id);
      assert.equal(r.chunks, 3);
      assert.equal(r.mime, "application/pdf");
      // The bytes are frozen once queued.
      assert.equal((await x.put(id, 1, parts[1])).status, 409);
      assert.equal((await x.finish(id)).status, 409);
      assert.equal(await x.reads(id), 1);

      const v = await x.view();
      assert.equal(v.reader, "ready");
      assert.deepEqual(
        v.uploads.map((y: any) => [y.id, y.state]),
        [[id, "queued"]],
      );

      // The preview: raw bytes, never an image or HTML type.
      const g = await x.chunk(id, 1);
      assert.equal(g.status, 200);
      assert.deepEqual(g.bytes, parts[1]);
      assert.equal(g.headers.get("content-type"), "application/octet-stream");
      assert.equal(g.headers.get("cache-control"), "no-store");
      assert.equal(g.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await x.chunk(id, 5)).status, 404);
    } finally {
      await x.f.close();
    }
  }));

test("pasted text is stored as one chunk and queued", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const text = "Potong rambut RM25\n剪发 RM25\nCuci + gaya RM40 😀";
      const r = await x.owner.req("POST", `${x.up}/text`, { text });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const u = r.body.data;
      assert.equal(u.kind, "text");
      assert.equal(u.state, "queued");
      assert.equal(u.bytes, enc(text).length);
      assert.equal(await x.chunks(u.id), 1);
      assert.equal(await x.reads(u.id), 1);
      assert.equal(Buffer.from((await x.chunk(u.id, 0)).bytes).toString(), text);
      for (const bad of ["   ", "x".repeat(20001)]) {
        const b = await x.owner.req("POST", `${x.up}/text`, { text: bad });
        assert.equal(b.status, 422);
      }
      // 20,000 characters exactly, counted as characters (not bytes).
      const max = await x.owner.req("POST", `${x.up}/text`, {
        text: "剪".repeat(20000),
      });
      assert.equal(max.status, 200, JSON.stringify(max.body));
    } finally {
      await x.f.close();
    }
  }));

test("sixth upload in a session is refused", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const c = await x.create();
        assert.equal(c.status, 200, JSON.stringify(c.body));
        ids.push(c.body.data.id);
      }
      const sixth = await x.create();
      assert.equal(sixth.status, 422);
      assert.equal(sixth.body.error.code, "UPLOAD_LIMIT");
      const paste = await x.owner.req("POST", `${x.up}/text`, { text: "a" });
      assert.equal(paste.body.error.code, "UPLOAD_LIMIT");
      // A removed upload no longer holds a session slot.
      assert.equal((await x.remove(ids[0])).status, 200);
      assert.equal((await x.create()).status, 200);
    } finally {
      await x.f.close();
    }
  }));

test("the eleventh in 24 hours is refused", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      // Ten earlier uploads in this workspace, all removed: removing does
      // not reset the cap, and they hold no session slot.
      assert.equal(UPLOAD_LIMITS.perOrgPerDay, 10);
      for (let i = 0; i < UPLOAD_LIMITS.perOrgPerDay; i++)
        await x.q(
          "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes,state) values($1,$2,'pdf','lama.pdf','application/pdf',10,'removed')",
          [x.f.h.orgA.id, x.sessionId],
        );
      const r = await x.create();
      assert.equal(r.status, 429);
      assert.equal(r.body.error.code, "UPLOAD_RATE");
      const paste = await x.owner.req("POST", `${x.up}/text`, { text: "a" });
      assert.equal(paste.status, 429);
      // Older than 24 hours: no longer counted.
      await x.q(
        "update app.setup_upload set created_at=now()-interval '25 hours' where org_id=$1",
        [x.f.h.orgA.id],
      );
      assert.equal((await x.create()).status, 200);
      // Another workspace has its own count.
      const bob = await x.f.api.request(
        x.f.h.bob,
        x.f.h.orgB.id,
        "POST",
        `/api/v1/agents/${x.f.h.orgB.agentId}/setup`,
        { mainPack: "appointment", extraPacks: [] },
      );
      assert.equal(bob.status, 200);
    } finally {
      await x.f.close();
    }
  }));

test("11 MB declared size is refused", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const r = await x.create({ bytes: 11 * 1000 * 1000 });
      assert.equal(r.status, 422);
      assert.equal(r.body.error.code, "UPLOAD_TOO_LARGE");
      assert.equal((await x.create({ bytes: 10 * MiB + 1 })).status, 422);
      assert.equal((await x.create({ bytes: 10 * MiB })).status, 200);
      assert.equal((await x.create({ bytes: 0 })).status, 422);
    } finally {
      await x.f.close();
    }
  }));

test("a chunk over 3 MiB is refused", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const c = await x.create({ bytes: 10 * MiB });
      const id = c.body.data.id;
      const big = await x.put(id, 0, cat(enc("%PDF-"), fill(3 * MiB - 4)));
      assert.equal(big.status, 413);
      assert.equal(await x.chunks(id), 0);
      const exact = await x.put(id, 0, cat(enc("%PDF-"), fill(3 * MiB - 5)));
      assert.equal(exact.status, 200);
      // Only application/octet-stream is read.
      const json = await x.owner.raw(
        "PUT",
        `${x.up}/${id}/chunks/1`,
        enc("{}"),
        { "content-type": "application/json" },
      );
      assert.equal(json.status, 415);
      // Seq outside 0..9, and an empty chunk.
      assert.equal((await x.put(id, 10, fill(10))).status, 422);
      assert.equal((await x.put(id, 1, new Uint8Array(0))).status, 422);
    } finally {
      await x.f.close();
    }
  }));

test("finish with a missing chunk is refused", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const c = await x.create({ bytes: 300 });
      const id = c.body.data.id;
      const none = await x.finish(id);
      assert.equal(none.status, 409);
      assert.equal(none.body.error.code, "UPLOAD_INCOMPLETE");
      await x.put(id, 0, pdf(100));
      await x.put(id, 2, fill(100));
      const gap = await x.finish(id);
      assert.equal(gap.status, 409);
      assert.equal(gap.body.error.code, "UPLOAD_INCOMPLETE");
      assert.equal((await x.row(id)).state, "uploading");
      assert.equal(await x.reads(id), 0);
      await x.put(id, 1, fill(100));
      assert.equal((await x.finish(id)).status, 200);
    } finally {
      await x.f.close();
    }
  }));

test("total bytes not equal to declared is refused", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const c = await x.create({ bytes: 300 });
      const id = c.body.data.id;
      await x.put(id, 0, pdf(100));
      await x.put(id, 1, fill(100));
      const short = await x.finish(id);
      assert.equal(short.status, 422);
      assert.equal(short.body.error.code, "UPLOAD_SIZE_MISMATCH");
      // More than declared is refused when the chunk arrives.
      const over = await x.put(id, 2, fill(101));
      assert.equal(over.status, 422);
      assert.equal(
        JSON.parse(Buffer.from(over.bytes).toString()).error.code,
        "UPLOAD_SIZE_MISMATCH",
      );
      assert.equal(await x.chunks(id), 2);
      assert.equal(await x.reads(id), 0);
    } finally {
      await x.f.close();
    }
  }));

test("type is checked by leading bytes, not by name", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      // A .jpg name with PDF bytes is stored as a PDF.
      const a = await x.upload([pdf(80)], {
        kind: "image",
        name: "gambar.jpg",
        mime: "image/jpeg",
      });
      assert.equal(a.done.status, 200, JSON.stringify(a.done.body));
      assert.equal(a.done.body.data.kind, "pdf");
      assert.equal((await x.row(a.id)).mime, "application/pdf");
      for (const [bytes, kind, mime] of [
        [jpeg, "image", "image/jpeg"],
        [png, "image", "image/png"],
        [webp, "image", "image/webp"],
      ] as const) {
        const u = await x.upload([bytes], { kind: "pdf", name: "fail.pdf" });
        assert.equal(u.done.body.data.kind, kind);
        assert.equal((await x.row(u.id)).mime, mime);
      }
      await x.q("update app.setup_upload set state='removed' where session_id=$1", [
        x.sessionId,
      ]);
      // CSV text declared as a sheet, with a Chinese character split across
      // the chunk boundary.
      const csv = enc("Item,Harga\n剪发,25\n");
      const cut = 12; // inside the three bytes of 剪
      const c = await x.upload([csv.slice(0, cut), csv.slice(cut)], {
        kind: "sheet",
        name: "harga.csv",
        mime: "text/csv",
      });
      assert.equal(c.done.status, 200, JSON.stringify(c.done.body));
      assert.equal(c.done.body.data.kind, "sheet");
      assert.equal((await x.row(c.id)).mime, "text/csv");
      // Aged past 24 hours too, so the refusals below stay under the
      // workspace's daily cap.
      await x.q(
        "update app.setup_upload set state='removed',created_at=now()-interval '25 hours' where session_id=$1",
        [x.sessionId],
      );

      // Refused: CSV text declared as an image, a GIF, text with a NUL byte,
      // bytes that are not UTF-8 text, and any zip (an .xlsx) whatever it is
      // declared as: Excel files have their own code so the screen can say so.
      const zipText = cat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), enc("a,b,c\n"));
      for (const [bytes, kind, code] of [
        [csv, "image", "UPLOAD_TYPE"],
        [cat(enc("GIF89a"), fill(20)), "image", "UPLOAD_TYPE"],
        [cat(enc("a,b\n"), new Uint8Array([0]), enc("c")), "sheet", "UPLOAD_TYPE"],
        [new Uint8Array([0xc3, 0x28, 0x41]), "sheet", "UPLOAD_TYPE"],
        [xlsx, "sheet", "UPLOAD_XLSX"],
        [xlsx, "image", "UPLOAD_XLSX"],
        [zipText, "sheet", "UPLOAD_XLSX"],
      ] as const) {
        const total = bytes.length;
        const cr = await x.create({ kind, bytes: total, name: "x.csv" });
        const id = cr.body.data.id;
        await x.put(id, 0, bytes);
        const key = randomUUID();
        const r = await x.owner.raw(
          "POST",
          `${x.up}/${id}/finish`,
          enc("{}"),
          { "content-type": "application/json", "idempotency-key": key },
        );
        assert.equal(r.status, 422);
        assert.equal(
          JSON.parse(Buffer.from(r.bytes).toString()).error.code,
          code,
        );
        // The refused upload's bytes are gone and it is no longer listed;
        // its row stays as removed so the 24-hour cap still counts it.
        const stored = await x.row(id);
        assert.equal(stored.state, "removed");
        assert.equal(stored.fail_code, code);
        assert.ok(stored.bytes_deleted_at);
        assert.equal(await x.chunks(id), 0);
        assert.equal(await x.reads(id), 0);
        assert.ok(!(await x.view()).uploads.some((u: any) => u.id === id));
        // A replay of the same request gives the same refusal.
        const replay = await x.owner.raw(
          "POST",
          `${x.up}/${id}/finish`,
          enc("{}"),
          { "content-type": "application/json", "idempotency-key": key },
        );
        assert.equal(replay.status, 422);
        assert.equal(
          JSON.parse(Buffer.from(replay.bytes).toString()).error.code,
          code,
        );
      }
    } finally {
      await x.f.close();
    }
  }));

test("delimited text over 1 MiB is refused at finish as too long, before it is read", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const line = enc("Item,Harga\n");
      const big = cat(line, fill(MiB + 1 - line.length, 0x61));
      const u = await x.upload([big], { kind: "sheet", name: "harga.csv", mime: "text/csv" });
      assert.equal(u.done.status, 422, JSON.stringify(u.done.body));
      assert.equal(u.done.body.error.code, "UPLOAD_TOO_LONG");
      const stored = await x.row(u.id);
      assert.equal(stored.state, "removed");
      assert.equal(stored.fail_code, "UPLOAD_TOO_LONG");
      assert.ok(stored.bytes_deleted_at);
      assert.equal(await x.chunks(u.id), 0);
      assert.equal(await x.reads(u.id), 0);
      // Exactly 1 MiB is still accepted.
      const ok = await x.upload([cat(line, fill(MiB - line.length, 0x61))], {
        kind: "sheet",
        name: "harga.csv",
        mime: "text/csv",
      });
      assert.equal(ok.done.status, 200, JSON.stringify(ok.done.body));
      assert.equal(ok.done.body.data.kind, "sheet");
    } finally {
      await x.f.close();
    }
  }));

test("staff cannot create or read chunks", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const u = await x.upload([pdf(50)], { bytes: 50 });
      const pending = (await x.create({ bytes: 50 })).body.data.id;
      const staff = x.as(x.f.h.staff);
      for (const r of [
        await x.create({}, staff),
        await staff.req("POST", `${x.up}/text`, { text: "a" }),
        await x.finish(pending, staff),
        await x.remove(u.id, staff),
      ])
        assert.equal(r.status, 403);
      assert.equal((await x.put(pending, 0, pdf(50), staff)).status, 403);
      assert.equal((await x.chunk(u.id, 0, staff)).status, 403);
      assert.equal(await x.chunks(pending), 0);
      assert.equal((await x.row(u.id)).state, "queued");
    } finally {
      await x.f.close();
    }
  }));

test("another workspace gets 404", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const u = await x.upload([pdf(50)], { bytes: 50 });
      const pending = (await x.create({ bytes: 50 })).body.data.id;
      // Bob, in his own workspace, names orgA's agent or orgA's upload.
      const bob = x.as(x.f.h.bob, x.f.h.orgB.id);
      const bobBase = `/agents/${x.f.h.orgB.agentId}/setup`;
      assert.equal(
        (await bob.req("POST", bobBase, { mainPack: "appointment", extraPacks: [] }))
          .status,
        200,
      );
      for (const r of [
        await x.create({}, bob),
        await bob.req("POST", `${x.up}/text`, { text: "a" }),
        await x.finish(pending, bob),
        await x.remove(u.id, bob),
        await bob.req("POST", `${bobBase}/uploads/${pending}/finish`, {}),
        await bob.req("DELETE", `${bobBase}/uploads/${u.id}`, {}),
      ])
        assert.equal(r.status, 404);
      for (const r of [
        await x.put(pending, 0, pdf(50), bob),
        await x.chunk(u.id, 0, bob),
        await bob.raw("PUT", `${bobBase}/uploads/${pending}/chunks/0`, pdf(50)),
        await bob.raw("GET", `${bobBase}/uploads/${u.id}/chunks/0`),
      ])
        assert.equal(r.status, 404);
      // Bob in orgA's workspace header: not a member.
      const intruder = x.as(x.f.h.bob, x.f.h.orgA.id);
      assert.equal((await x.chunk(u.id, 0, intruder)).status, 404);
      assert.equal(await x.chunks(pending), 0);
      assert.equal((await x.row(u.id)).state, "queued");
    } finally {
      await x.f.close();
    }
  }));

test("remove deletes chunks and that upload's pending and removed items, keeps confirmed and applied ones", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const u = await x.upload([pdf(60)], { bytes: 60 });
      const other = await x.upload([pdf(60)], { bytes: 60 });
      const add = (
        kind: string,
        key: string,
        payload: unknown,
        state = "pending",
        source = "import",
      ) =>
        x.q(
          "insert into app.setup_item(org_id,session_id,kind,key,payload,source,state) values($1,$2,$3,$4,$5,$6,$7)",
          [x.f.h.orgA.id, x.sessionId, kind, key, JSON.stringify(payload), source, state],
        );
      const row = (uploadId: string, item: string) => ({
        uploadId,
        item,
        variant: "",
        priceSen: 2500,
        unit: "",
        notes: "",
      });
      await add("catalogue_row", `${u.id}:0`, row(u.id, "Potong rambut"));
      await add("catalogue_row", `${u.id}:1`, row(u.id, "Cuci rambut"), "confirmed");
      await add("catalogue_row", `${u.id}:2`, row(u.id, "Gaya"), "removed");
      await add("catalogue_row", `${u.id}:3`, row(u.id, "Rawatan"), "applied");
      await add("catalogue_row", `${other.id}:0`, row(other.id, "Warna"));
      await add("catalogue_row", `${other.id}:1`, row(other.id, "Kerinting"), "removed");
      await add("fact", "services_offered", {
        packId: "appointment",
        fieldKey: "services_offered",
        title: "Services",
        value: "Potong, cuci",
        language: "mixed",
        uploadId: u.id,
      });
      await add("fact", "business_name", {
        packId: "every-business",
        fieldKey: "business_name",
        title: "Business name",
        value: "Kedai Contoh",
        language: "mixed",
        uploadId: u.id,
      }, "removed");
      await add(
        "fact",
        "address",
        { packId: "base", fieldKey: "address", title: "Address", value: "Jalan Contoh 1", language: "mixed" },
        "pending",
        "interview",
      );
      const before = (await x.view()).session.revision;

      const r = await x.remove(u.id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.data, { removed: true });
      assert.equal(await x.chunks(u.id), 0);
      assert.equal((await x.row(u.id)).state, "removed");
      assert.ok((await x.row(u.id)).bytes_deleted_at);
      assert.equal(await x.chunks(other.id), 1);
      assert.equal((await x.row(other.id)).bytes_deleted_at, null);
      const items = (
        await x.q(
          "select key,state from app.setup_item where session_id=$1 order by key",
          [x.sessionId],
        )
      ).rows.map((i) => `${i.key}=${i.state}`);
      assert.deepEqual(
        items.sort(),
        [
          `${other.id}:0=pending`,
          `${other.id}:1=removed`,
          `${u.id}:1=confirmed`,
          `${u.id}:3=applied`,
          "address=pending",
        ].sort(),
      );
      const v = await x.view();
      assert.ok(v.session.revision > before);
      assert.deepEqual(
        v.uploads.map((y: any) => y.id),
        [other.id],
      );
      assert.equal((await x.chunk(u.id, 0)).status, 404);
      // Removing again is harmless and keeps the first deletion time.
      const deletedAt = (await x.row(u.id)).bytes_deleted_at;
      assert.equal((await x.remove(u.id)).status, 200);
      assert.deepEqual((await x.row(u.id)).bytes_deleted_at, deletedAt);
      // An upload left half-sent can be removed too.
      const half = (await x.create({ bytes: 300 })).body.data.id;
      await x.put(half, 0, pdf(100));
      assert.equal((await x.remove(half)).status, 200);
      assert.equal(await x.chunks(half), 0);
      assert.equal(await x.reads(half), 0);
    } finally {
      await x.f.close();
    }
  }));

test('reader off: create is refused with READER_OFF and the view says reader "off"', async () => {
  for (const value of [undefined, "", "disabled", "openai"])
    await withReader(value, async () => {
      const x = await fixture();
      try {
        const r = await x.create();
        assert.equal(r.status, 503, String(value));
        assert.equal(r.body.error.code, "READER_OFF");
        const p = await x.owner.req("POST", `${x.up}/text`, { text: "a" });
        assert.equal(p.status, 503);
        assert.equal(p.body.error.code, "READER_OFF");
        // The interview still works: the view loads and says the reader is off.
        const v = await x.f.req("GET", x.base);
        assert.equal(v.status, 200);
        assert.equal(v.body.data.reader, "off");
        assert.deepEqual(v.body.data.uploads, []);
        assert.equal(
          Number(
            (
              await x.q("select count(*) from app.setup_upload where org_id=$1", [
                x.f.h.orgA.id,
              ])
            ).rows[0].count,
          ),
          0,
        );
      } finally {
        await x.f.close();
      }
    });
});

test("an applied session refuses uploads with 409", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const queued = await x.upload([pdf(50)], { bytes: 50 });
      const pending = (await x.create({ bytes: 50 })).body.data.id;
      const rev = (await x.view()).session.revision;
      const applied = await x.f.req("POST", `${x.base}/apply`, {
        expectedRevision: rev,
        replace: [],
      });
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      for (const r of [
        await x.create(),
        await x.owner.req("POST", `${x.up}/text`, { text: "a" }),
        await x.finish(pending),
      ])
        assert.equal(r.status, 409);
      assert.equal((await x.put(pending, 0, pdf(50))).status, 409);
      // The owner may still delete an upload now; the preview still reads.
      assert.equal((await x.chunk(queued.id, 0)).status, 200);
      assert.equal((await x.remove(queued.id)).status, 200);
      assert.equal(await x.chunks(queued.id), 0);
      // Without any session the upload commands are 404.
      const fresh = await x.f.api.request(
        x.f.h.bob,
        x.f.h.orgB.id,
        "POST",
        `/api/v1/agents/${x.f.h.orgB.agentId}/setup/uploads`,
        { kind: "pdf", name: "a.pdf", mime: "application/pdf", bytes: 10 },
      );
      assert.equal(fresh.status, 404);
    } finally {
      await x.f.close();
    }
  }));

// Sign-in already requires a confirmed email in every mode: verifyIdentity
// (web/lib/server/auth.ts) refuses any token whose user has no
// email_confirmed_at, before any command runs. This proves it for uploads.
test("an account whose email is not confirmed is refused", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      await x.q("update auth.users set email_confirmed_at=null where id=$1", [
        x.f.h.alice.userId,
      ]);
      const r = await x.create();
      assert.equal(r.status, 401);
      assert.equal(r.body.error.code, "UNAUTHORIZED");
      const p = await x.owner.req("POST", `${x.up}/text`, { text: "a" });
      assert.equal(p.status, 401);
      assert.equal(
        Number(
          (
            await x.q("select count(*) from app.setup_upload where org_id=$1", [
              x.f.h.orgA.id,
            ])
          ).rows[0].count,
        ),
        0,
      );
    } finally {
      await x.f.close();
    }
  }));

test("chunk writes per upload are capped at 30; a replayed request does not count twice", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const id = (await x.create({ bytes: 50 })).body.data.id;
      const path = `${x.up}/${id}/chunks/0`;
      const key = randomUUID();
      for (let i = 0; i < 3; i++)
        assert.equal(
          (await x.owner.raw("PUT", path, pdf(50), { "idempotency-key": key })).status,
          200,
        );
      assert.equal((await x.row(id)).writes, 1);
      for (let i = 1; i < 30; i++)
        assert.equal((await x.put(id, 0, pdf(50))).status, 200, String(i));
      assert.equal((await x.row(id)).writes, 30);
      const last = cat(enc("%PDF-"), fill(45, 0x4c));
      const refused = await x.put(id, 0, last);
      assert.equal(refused.status, 429);
      assert.equal(
        JSON.parse(Buffer.from(refused.bytes).toString()).error.code,
        "UPLOAD_RATE",
      );
      // Nothing stored: the chunk still holds the earlier bytes.
      assert.deepEqual((await x.chunk(id, 0)).bytes, pdf(50));
      assert.equal((await x.row(id)).writes, 30);
      // The upload can still be finished with what it has.
      assert.equal((await x.finish(id)).status, 200);
    } finally {
      await x.f.close();
    }
  }));

test("two concurrent creates at the session cap: exactly one succeeds", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      for (let i = 0; i < 4; i++) assert.equal((await x.create()).status, 200);
      const both = await Promise.all([x.create(), x.create()]);
      assert.deepEqual(
        both.map((r) => r.status).sort(),
        [200, 422],
        JSON.stringify(both.map((r) => r.body)),
      );
      assert.equal(
        both.find((r) => r.status === 422)!.body.error.code,
        "UPLOAD_LIMIT",
      );
      assert.equal(
        Number(
          (
            await x.q(
              "select count(*) from app.setup_upload where session_id=$1 and state<>'removed'",
              [x.sessionId],
            )
          ).rows[0].count,
        ),
        5,
      );
    } finally {
      await x.f.close();
    }
  }));

test("put and finish after remove give 409, replays included", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      // Fresh requests on a removed upload.
      const a = (await x.create({ bytes: 50 })).body.data.id;
      await x.put(a, 0, pdf(50));
      assert.equal((await x.remove(a)).status, 200);
      assert.equal((await x.put(a, 0, pdf(50))).status, 409);
      assert.equal((await x.finish(a)).status, 409);
      // A chunk PUT replayed (same key) after remove.
      const b = (await x.create({ bytes: 50 })).body.data.id;
      const putKey = randomUUID();
      const path = `${x.up}/${b}/chunks/0`;
      assert.equal(
        (await x.owner.raw("PUT", path, pdf(50), { "idempotency-key": putKey })).status,
        200,
      );
      // A finish replayed (same key) after remove.
      const finishKey = randomUUID();
      const finish = () =>
        x.owner.raw("POST", `${x.up}/${b}/finish`, enc("{}"), {
          "content-type": "application/json",
          "idempotency-key": finishKey,
        });
      assert.equal((await finish()).status, 200);
      assert.equal((await x.remove(b)).status, 200);
      assert.equal(
        (await x.owner.raw("PUT", path, pdf(50), { "idempotency-key": putKey })).status,
        409,
      );
      assert.equal((await finish()).status, 409);
    } finally {
      await x.f.close();
    }
  }));

test("a tiny first chunk is sniffed across chunks", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const file = pdf(40);
      const u = await x.upload([file.slice(0, 2), file.slice(2, 3), file.slice(3)], {
        kind: "image",
        name: "a.jpg",
      });
      assert.equal(u.done.status, 200, JSON.stringify(u.done.body));
      assert.equal(u.done.body.data.kind, "pdf");
      const w = await x.upload([webp.slice(0, 5), webp.slice(5, 9), webp.slice(9)]);
      assert.equal(w.done.body.data.kind, "image");
      assert.equal((await x.row(w.id)).mime, "image/webp");
    } finally {
      await x.f.close();
    }
  }));

test("upload names and mime types refuse control and bidi override characters; names are trimmed", () => {
  const base = { kind: "pdf", name: "harga.pdf", mime: "application/pdf", bytes: 10 };
  assert.equal(
    setupUploadCreate.parse({ ...base, name: "  harga.pdf  " }).name,
    "harga.pdf",
  );
  for (const bad of [
    { name: "har\u0000ga.pdf" },
    { name: "har\u0007ga.pdf" },
    { name: "har\u0085ga.pdf" },
    { name: "fdp.\u202eexe" },
    { name: "a\u2066b.pdf" },
    { name: "a\u2069b.pdf" },
    { mime: "application/pdf\u000d\u000ax" },
    { mime: "application/\u202dpdf" },
    { mime: "image/\u2068png" },
  ])
    assert.equal(setupUploadCreate.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad));
  assert.equal(setupUploadCreate.safeParse({ ...base, name: "剪发 价目表.pdf" }).success, true);
});

test("a chunk PUT from staff, a stranger or for a closed upload is refused before its body is read", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const dispatch = createDispatch({});
      const live = (await x.create({ bytes: 50 })).body.data.id;
      const gone = (await x.create({ bytes: 50 })).body.data.id;
      assert.equal((await x.remove(gone)).status, 200);
      const send = async (
        actor: typeof x.f.h.alice,
        orgId: string,
        uploadId: string,
      ) => {
        const csrf = await handleAuth(new Request("http://127.0.0.1:4182/api/auth/csrf"));
        const token = (await csrf.json()).data.token;
        const challenge = csrf.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        let read = false;
        const body = new ReadableStream<Uint8Array>(
          {
            pull() {
              read = true;
              throw Error("BODY_READ");
            },
          },
          { highWaterMark: 0 },
        );
        const response = await dispatch(
          new Request(
            `http://127.0.0.1:4182/api/v1${x.up}/${uploadId}/chunks/0`,
            {
              method: "PUT",
              headers: {
                "content-type": "application/octet-stream",
                cookie: `${challenge}; ca_local_access=${actor.token}; ca_local_refresh=${actor.refreshToken}`,
                origin: "http://127.0.0.1:4182",
                "x-csrf-token": token,
                "x-organization-id": orgId,
                "idempotency-key": randomUUID(),
              },
              body,
              duplex: "half",
            } as RequestInit,
          ),
        );
        return { status: response.status, read };
      };
      assert.deepEqual(await send(x.f.h.staff, x.f.h.orgA.id, live), { status: 403, read: false });
      assert.deepEqual(await send(x.f.h.bob, x.f.h.orgA.id, live), { status: 404, read: false });
      assert.deepEqual(await send(x.f.h.bob, x.f.h.orgB.id, live), { status: 404, read: false });
      assert.deepEqual(await send(x.f.h.alice, x.f.h.orgA.id, gone), { status: 409, read: false });
      // The owner's PUT on a live upload does read the body (and fails on it).
      const owner = await send(x.f.h.alice, x.f.h.orgA.id, live);
      assert.equal(owner.read, true);
    } finally {
      await x.f.close();
    }
  }));


test("the web client's raw chunk calls work against the route; a lost answer re-sent counts once", () =>
  withReader("anthropic", async () => {
    const x = await fixture();
    try {
      const { HttpCoreClient } = await import("../../web/lib/core/client.ts");
      let lose = true;
      const client = new HttpCoreClient({
        orgId: x.f.h.orgA.id,
        fetch: async (url, init) => {
          const u = String(url);
          if (u === "/api/auth/csrf")
            return Response.json({ ok: true, data: { token: "unused" } });
          const h = new Headers(init?.headers);
          const body = init?.body
            ? new Uint8Array(await (init.body as Blob).arrayBuffer())
            : undefined;
          // The harness supplies its own CSRF token; the client's content
          // type and idempotency key go through as sent.
          const r = await x.f.api.raw(x.f.h.alice, x.f.h.orgA.id, init?.method ?? "GET", u, body, {
            ...(h.get("content-type") ? { "content-type": h.get("content-type")! } : {}),
            ...(h.get("idempotency-key") ? { "idempotency-key": h.get("idempotency-key")! } : {}),
          });
          if (init?.method === "PUT" && lose) {
            lose = false;
            throw Error("LOST_RESPONSE_AFTER_COMMIT");
          }
          return new Response(r.bytes as BodyInit, { status: r.status, headers: r.headers });
        },
      });
      const id = (await x.create({ bytes: 50 })).body.data.id as string;
      const bytes = new Blob([pdf(50)]);
      const input = { id: x.agentId, uploadId: id, seq: 0 };
      await assert.rejects(client.putChunk(input, bytes), /LOST_RESPONSE/);
      assert.deepEqual(await client.putChunk(input, bytes), { received: 50 });
      assert.equal((await x.row(id)).writes, 1, "the re-send replayed the receipt");
      assert.deepEqual([...(await client.getChunk(input))], [...pdf(50)]);
      assert.equal((await x.finish(id)).status, 200);
    } finally {
      await x.f.close();
    }
  }));
