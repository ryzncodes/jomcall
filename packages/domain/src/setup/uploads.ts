// Guided setup document import: the upload store (app.setup_upload and
// app.setup_upload_chunk). An owner or admin creates an upload, sends its
// chunks, and finishes it; finishing checks the bytes and queues one read for
// the agent process (outbox kind setup.read). No model is called here, and
// nothing an upload holds reaches the agent before applySetup.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  AppError,
  uuid,
  type TenantContext,
} from "../../../contracts/src/index.ts";
import {
  UPLOAD_LIMITS,
  setupPasteText,
  setupUploadCreate,
  uploadSeq,
  type SetupUpload,
} from "../../../contracts/src/setup-upload.ts";
import { audit, command } from "../../../db/src/receipts.ts";
import { setupReader } from "../../../inference/src/provider.ts";
import { SHEET_LIMITS } from "../../../inference/src/sheet-text.ts";
import { manager, namespace } from "../authorization.ts";

// Whether uploads are accepted. A malformed switch counts as off, so the
// setup view (and the interview) keeps working; create and paste refuse.
export function readerReady(): boolean {
  try {
    return setupReader() === "anthropic";
  } catch {
    return false;
  }
}

type UploadRow = {
  id: string;
  session_id: string;
  kind: SetupUpload["kind"];
  name: string;
  mime: string;
  bytes: number;
  chunks: number;
  state: SetupUpload["state"];
  fail_code: string | null;
  row_count: number;
  fact_count: number;
  dropped_count: number;
  bytes_deleted_at: Date | null;
  writes: number;
  created_at: Date;
};
const publicUpload = (r: UploadRow): SetupUpload => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  bytes: r.bytes,
  state: r.state,
  failCode: r.fail_code,
  rowCount: r.row_count,
  factCount: r.fact_count,
  droppedCount: r.dropped_count,
  bytesDeletedAt: r.bytes_deleted_at
    ? new Date(r.bytes_deleted_at).toISOString()
    : null,
  createdAt: new Date(r.created_at).toISOString(),
});

// The uploads the setup view lists: the session's, minus removed ones.
export async function listUploads(
  tx: PoolClient,
  orgId: string,
  sessionId: string,
): Promise<SetupUpload[]> {
  return (
    await tx.query(
      "select * from app.setup_upload where org_id=$1 and session_id=$2 and state<>'removed' order by created_at,id",
      [orgId, sessionId],
    )
  ).rows.map(publicUpload);
}

const starts = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
// The stored kind and mime, from the leading bytes only. The client's kind,
// name and mime are hints and decide nothing here.
function sniff(head: Uint8Array): { kind: SetupUpload["kind"]; mime: string } | null {
  if (starts(head, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg" };
  if (starts(head, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png" };
  if (starts(head, ascii("RIFF")) && starts(head, ascii("WEBP"), 8))
    return { kind: "image", mime: "image/webp" };
  if (starts(head, ascii("%PDF-"))) return { kind: "pdf", mime: "application/pdf" };
  return null;
}
// A zip (an .xlsx, or anything else zip-based) is refused with its own code:
// Excel files are not read in this release (owner decision, 2026-11-15).
const isZip = (head: Uint8Array) => starts(head, [0x50, 0x4b, 0x03, 0x04]);
// CSV: the whole file is valid UTF-8 text with no NUL byte. One streaming
// decoder runs over the chunks in order (no joined copy), so a character
// split across two chunks is not refused.
function isText(parts: Uint8Array[]): boolean {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (const p of parts) {
      if (p.includes(0)) return false;
      decoder.decode(p, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}
// A Buffer over the same memory, for pg parameters (no copy).
const asBuffer = (b: Uint8Array) =>
  Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength);

const pathPattern =
  /^\/agents\/([^/]+)\/setup\/uploads(?:\/(text)|\/([^/]+)(?:\/(finish)|\/chunks\/([^/]+))?)?$/;

// Before a chunk body is read: a cheap check, in its own short transaction,
// that the caller is an owner or admin and the upload exists here, is still
// uploading in the open session and has writes left. Staff, strangers and
// late chunks are refused without the server buffering up to 3 MiB. The
// command repeats every check under its locks.
export async function precheckChunkPut(
  tx: PoolClient,
  ctx: TenantContext,
  path: string,
) {
  const m = path.match(pathPattern);
  if (!m?.[3] || m[5] === undefined) throw new AppError("NOT_FOUND", 404);
  manager(ctx);
  const agentId = uuid.parse(m[1]);
  const uploadId = uuid.parse(m[3]);
  uploadSeq.parse(m[5]);
  const u = (
    await tx.query(
      `select u.state,u.writes,s.state as session_state from app.setup_upload u
       join app.setup_session s on s.org_id=u.org_id and s.id=u.session_id
       where u.org_id=$1 and s.agent_id=$2 and u.id=$3`,
      [ctx.orgId, agentId, uploadId],
    )
  ).rows[0] as
    | { state: string; writes: number; session_state: string }
    | undefined;
  if (!u) throw new AppError("NOT_FOUND", 404);
  if (u.state !== "uploading" || u.session_state !== "open")
    throw new AppError("CONFLICT", 409);
  if (u.writes >= UPLOAD_LIMITS.chunkWrites)
    throw new AppError("UPLOAD_RATE", 429);
}

type Result = SetupUpload | { received: number } | { removed: true } | Response | AppError;

// Returns undefined when the path is not an upload command. A returned (not
// thrown) AppError is a refusal whose writes must stay: the transaction
// commits and the caller answers with the error.
export async function setupUploadRoute(
  tx: PoolClient,
  ctx: TenantContext,
  method: string,
  path: string,
  body: unknown,
  key: string,
): Promise<Result | undefined> {
  const m = path.match(pathPattern);
  if (!m) return;
  const op =
    m[2] && method === "POST"
      ? "paste"
      : !m[2] && !m[3] && method === "POST"
        ? "create"
        : m[3] && m[4] && method === "POST"
          ? "finish"
          : m[3] && m[5] !== undefined && method === "PUT"
            ? "put"
            : m[3] && m[5] !== undefined && method === "GET"
              ? "chunk"
              : m[3] && !m[4] && m[5] === undefined && method === "DELETE"
                ? "remove"
                : null;
  if (!op) return;
  manager(ctx);
  const agentId = uuid.parse(m[1]);
  const uploadId = m[3] ? uuid.parse(m[3]) : null;
  const seq = m[5] !== undefined ? uploadSeq.parse(m[5]) : null;

  // The agent row lock comes first, as in every other setup command. "No key
  // update" still queues behind (and holds off) their "for update", but does
  // not block rows that reference the agent (test sessions, calls, turns).
  const lockAgent = async () => {
    const hit = await tx.query(
      "select id from app.agent where org_id=$1 and id=$2 for no key update",
      [ctx.orgId, agentId],
    );
    if (!hit.rowCount) throw new AppError("NOT_FOUND", 404);
  };
  // The open session, locked. Applied (and no open one): a conflict, as in
  // lockedSession; never started: not found.
  const openSession = async () => {
    const s = (
      await tx.query(
        "select id,revision from app.setup_session where org_id=$1 and agent_id=$2 and state='open' for update",
        [ctx.orgId, agentId],
      )
    ).rows[0] as { id: string; revision: number } | undefined;
    if (s) return s;
    const applied = await tx.query(
      "select 1 from app.setup_session where org_id=$1 and agent_id=$2 and state='applied' limit 1",
      [ctx.orgId, agentId],
    );
    if (applied.rowCount) throw new AppError("CONFLICT", 409);
    throw new AppError("NOT_FOUND", 404);
  };
  // An upload of any session of this agent.
  const findUpload = async (lock: boolean) => {
    const u = (
      await tx.query(
        `select u.* from app.setup_upload u join app.setup_session s on s.org_id=u.org_id and s.id=u.session_id
         where u.org_id=$1 and s.agent_id=$2 and u.id=$3${lock ? " for update of u" : ""}`,
        [ctx.orgId, agentId, uploadId],
      )
    ).rows[0] as UploadRow | undefined;
    if (!u) throw new AppError("NOT_FOUND", 404);
    return u;
  };
  // Chunks are accepted and finished only while uploading, in the open
  // session: once queued the bytes are frozen.
  const uploadingIn = async (sessionId: string) => {
    const u = await findUpload(true);
    if (u.session_id !== sessionId || u.state !== "uploading")
      throw new AppError("CONFLICT", 409);
    return u;
  };
  // A replay after the upload was removed is a conflict, not a stale success.
  const notRemoved = async (id: unknown) => {
    const u = (
      await tx.query("select state from app.setup_upload where org_id=$1 and id=$2", [
        ctx.orgId,
        id,
      ])
    ).rows[0] as { state: string } | undefined;
    if (!u) throw new AppError("NOT_FOUND", 404);
    if (u.state === "removed") throw new AppError("CONFLICT", 409);
  };
  const loadUpload = async (id: unknown) => {
    const u = (
      await tx.query("select * from app.setup_upload where org_id=$1 and id=$2", [
        ctx.orgId,
        id,
      ])
    ).rows[0] as UploadRow | undefined;
    if (!u) throw new AppError("NOT_FOUND", 404);
    return publicUpload(u);
  };
  // Database counts, so every web process sees the same caps. One lock per
  // workspace keeps two concurrent creates from both passing.
  const checkCaps = async (sessionId: string) => {
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      "setup_upload:" + ctx.orgId,
    ]);
    const live = (
      await tx.query(
        "select count(*)::int as n from app.setup_upload where org_id=$1 and session_id=$2 and state<>'removed'",
        [ctx.orgId, sessionId],
      )
    ).rows[0].n as number;
    if (live >= UPLOAD_LIMITS.perSession) throw new AppError("UPLOAD_LIMIT", 422);
    // Removed uploads count, so removing does not reset the cap.
    const recent = (
      await tx.query(
        "select count(*)::int as n from app.setup_upload where org_id=$1 and created_at>now()-interval '24 hours'",
        [ctx.orgId],
      )
    ).rows[0].n as number;
    if (recent >= UPLOAD_LIMITS.perOrgPerDay) throw new AppError("UPLOAD_RATE", 429);
  };
  const queueRead = (id: string) =>
    tx.query(
      "insert into app.outbox(org_id,namespace,kind,resource_id) values($1,$2,'setup.read',$3)",
      [ctx.orgId, namespace(), id],
    );

  if (op === "chunk") {
    const u = await findUpload(false);
    if (u.state === "removed") throw new AppError("NOT_FOUND", 404);
    const hit = (
      await tx.query(
        "select data from app.setup_upload_chunk where org_id=$1 and upload_id=$2 and seq=$3",
        [ctx.orgId, u.id, seq],
      )
    ).rows[0] as { data: Buffer } | undefined;
    if (!hit) throw new AppError("NOT_FOUND", 404);
    // Never served as an image or a page: raw bytes for the preview only.
    return new Response(hit.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  }

  if (op === "create" || op === "paste") {
    if (!readerReady()) throw new AppError("READER_OFF", 503);
    if (op === "create") {
      const v = setupUploadCreate.parse(body);
      if (v.bytes > UPLOAD_LIMITS.uploadBytes)
        throw new AppError("UPLOAD_TOO_LARGE", 422);
      return command(
        tx,
        ctx,
        key,
        "setup.upload.create",
        { agentId, ...v },
        async () => {
          await lockAgent();
          const s = await openSession();
          await checkCaps(s.id);
          // Kind and mime start as the client's hints; finish replaces both
          // with what the leading bytes say.
          const row = (
            await tx.query(
              "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes,created_by) values($1,$2,$3,$4,$5,$6,$7) returning *",
              [ctx.orgId, s.id, v.kind, v.name, v.mime, v.bytes, ctx.identity.userId],
            )
          ).rows[0] as UploadRow;
          await audit(tx, ctx, "setup.upload.create", "setup_upload", row.id, {
            bytes: v.bytes,
          });
          return { ref: { id: row.id }, data: publicUpload(row) };
        },
        (ref) => loadUpload(ref.id),
      );
    }
    const v = setupPasteText.parse(body);
    return command(
      tx,
      ctx,
      key,
      "setup.upload.text",
      { agentId, ...v },
      async () => {
        await lockAgent();
        const s = await openSession();
        await checkCaps(s.id);
        const data = Buffer.from(v.text, "utf8");
        const row = (
          await tx.query(
            "insert into app.setup_upload(org_id,session_id,kind,name,mime,bytes,chunks,state,created_by) values($1,$2,'text','Pasted text','text/plain; charset=utf-8',$3,1,'queued',$4) returning *",
            [ctx.orgId, s.id, data.length, ctx.identity.userId],
          )
        ).rows[0] as UploadRow;
        await tx.query(
          "insert into app.setup_upload_chunk(org_id,upload_id,seq,data) values($1,$2,0,$3)",
          [ctx.orgId, row.id, data],
        );
        await queueRead(row.id);
        await audit(tx, ctx, "setup.upload.text", "setup_upload", row.id, {
          bytes: data.length,
        });
        return { ref: { id: row.id }, data: publicUpload(row) };
      },
      (ref) => loadUpload(ref.id),
    );
  }

  if (op === "put") {
    if (!(body instanceof Uint8Array))
      throw new AppError("OCTET_STREAM_REQUIRED", 415);
    if (!body.length) throw new AppError("EMPTY_CHUNK", 422);
    if (body.length > UPLOAD_LIMITS.chunkBytes)
      throw new AppError("PAYLOAD_TOO_LARGE", 413);
    // The receipt hashes a digest of the bytes, never the bytes themselves,
    // and stores only the upload id, seq and running total.
    const digest = createHash("sha256").update(body).digest("hex");
    return command(
      tx,
      ctx,
      key,
      "setup.upload.chunk",
      { agentId, uploadId, seq, sha256: digest, size: body.length },
      async () => {
        await lockAgent();
        const s = await openSession();
        const u = await uploadingIn(s.id);
        // Every write counts, re-sends included; a receipt replay never gets
        // here, so it does not count twice.
        if (u.writes >= UPLOAD_LIMITS.chunkWrites)
          throw new AppError("UPLOAD_RATE", 429);
        const others = (
          await tx.query(
            "select coalesce(sum(octet_length(data)),0)::int as n from app.setup_upload_chunk where org_id=$1 and upload_id=$2 and seq<>$3",
            [ctx.orgId, u.id, seq],
          )
        ).rows[0].n as number;
        // Stored bytes never exceed the declared size.
        if (others + body.length > u.bytes)
          throw new AppError("UPLOAD_SIZE_MISMATCH", 422);
        // A re-sent seq replaces the earlier bytes.
        await tx.query(
          `insert into app.setup_upload_chunk(org_id,upload_id,seq,data) values($1,$2,$3,$4)
           on conflict(upload_id,seq) do update set data=excluded.data`,
          [ctx.orgId, u.id, seq, asBuffer(body)],
        );
        await tx.query(
          "update app.setup_upload set writes=writes+1 where org_id=$1 and id=$2",
          [ctx.orgId, u.id],
        );
        const received = others + body.length;
        return { ref: { id: u.id, seq, received }, data: { received } };
      },
      async (ref) => {
        await notRemoved(ref.id);
        return { received: ref.received as number };
      },
    );
  }

  if (op === "finish") {
    return command<SetupUpload | AppError>(
      tx,
      ctx,
      key,
      "setup.upload.finish",
      { agentId, uploadId },
      async () => {
        await lockAgent();
        const s = await openSession();
        const u = await uploadingIn(s.id);
        const parts = (
          await tx.query(
            "select seq,octet_length(data)::int as n from app.setup_upload_chunk where org_id=$1 and upload_id=$2 order by seq",
            [ctx.orgId, u.id],
          )
        ).rows as { seq: number; n: number }[];
        // Seqs must be exactly 0..n-1; only then is the total compared.
        if (!parts.length || parts.some((p, i) => p.seq !== i))
          throw new AppError("UPLOAD_INCOMPLETE", 409);
        if (parts.reduce((t, p) => t + p.n, 0) !== u.bytes)
          throw new AppError("UPLOAD_SIZE_MISMATCH", 422);
        // The first 16 bytes of the file, across chunks in seq order, so a
        // tiny first chunk is sniffed correctly.
        const heads = (
          await tx.query(
            "select substring(data from 1 for 16) as head from app.setup_upload_chunk where org_id=$1 and upload_id=$2 order by seq",
            [ctx.orgId, u.id],
          )
        ).rows.map((r) => r.head as Buffer);
        const head = Buffer.concat(heads).subarray(0, 16);
        const zip = isZip(head);
        let found = zip ? null : sniff(head);
        // Delimited text over the reader's limit could never be read: refused
        // before its chunks are read into memory.
        const long = !found && !zip && u.kind === "sheet" && u.bytes > SHEET_LIMITS.bytes;
        if (!found && !zip && !long && u.kind === "sheet") {
          const all = (
            await tx.query(
              "select data from app.setup_upload_chunk where org_id=$1 and upload_id=$2 order by seq",
              [ctx.orgId, u.id],
            )
          ).rows.map((r) => r.data as Buffer);
          if (isText(all)) found = { kind: "sheet", mime: "text/csv" };
        }
        if (!found) {
          // Refused: the bytes are deleted. The row stays as removed, so the
          // 24-hour cap still counts it and the session slot is freed.
          const code = zip ? "UPLOAD_XLSX" : long ? "UPLOAD_TOO_LONG" : "UPLOAD_TYPE";
          await tx.query(
            "delete from app.setup_upload_chunk where org_id=$1 and upload_id=$2",
            [ctx.orgId, u.id],
          );
          await tx.query(
            "update app.setup_upload set state='removed',fail_code=$3,bytes_deleted_at=now() where org_id=$1 and id=$2",
            [ctx.orgId, u.id, code],
          );
          await audit(tx, ctx, "setup.upload.refused", "setup_upload", u.id, {
            code,
          });
          return {
            ref: { id: u.id, refused: code },
            data: new AppError(code, 422),
          };
        }
        const row = (
          await tx.query(
            "update app.setup_upload set kind=$3,mime=$4,chunks=$5,state='queued' where org_id=$1 and id=$2 returning *",
            [ctx.orgId, u.id, found.kind, found.mime, parts.length],
          )
        ).rows[0] as UploadRow;
        await queueRead(row.id);
        await audit(tx, ctx, "setup.upload.finish", "setup_upload", row.id, {
          kind: found.kind,
        });
        return { ref: { id: row.id }, data: publicUpload(row) };
      },
      async (ref) => {
        if (typeof ref.refused === "string") return new AppError(ref.refused, 422);
        await notRemoved(ref.id);
        return loadUpload(ref.id);
      },
    );
  }

  // remove: allowed in any session state, so the owner can delete an upload
  // now even after applying. Items the owner confirmed (and applied ones)
  // stay; pending ones and ones the owner removed one by one go with it.
  return command(
    tx,
    ctx,
    key,
    "setup.upload.remove",
    { agentId, uploadId },
    async () => {
      await lockAgent();
      const found = await findUpload(false);
      const session = (
        await tx.query(
          "select id,state from app.setup_session where org_id=$1 and id=$2 for update",
          [ctx.orgId, found.session_id],
        )
      ).rows[0] as { id: string; state: string };
      const u = await findUpload(true);
      if (u.state !== "removed") {
        await tx.query(
          "delete from app.setup_upload_chunk where org_id=$1 and upload_id=$2",
          [ctx.orgId, u.id],
        );
        const gone = await tx.query(
          `delete from app.setup_item where org_id=$1 and session_id=$2 and state in ('pending','removed')
           and kind in ('catalogue_row','fact') and payload->>'uploadId'=$3`,
          [ctx.orgId, session.id, u.id],
        );
        await tx.query(
          "update app.setup_upload set state='removed',lease_until=null,bytes_deleted_at=coalesce(bytes_deleted_at,now()) where org_id=$1 and id=$2",
          [ctx.orgId, u.id],
        );
        // Items changed: the open review page must reload.
        if (gone.rowCount && session.state === "open")
          await tx.query(
            "update app.setup_session set revision=revision+1,updated_at=now() where id=$1",
            [session.id],
          );
        await audit(tx, ctx, "setup.upload.remove", "setup_upload", u.id, {
          items: gone.rowCount ?? 0,
        });
      }
      return { ref: { id: uploadId }, data: { removed: true as const } };
    },
    async () => ({ removed: true as const }),
  );
}
