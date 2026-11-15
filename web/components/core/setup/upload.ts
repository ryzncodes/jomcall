// Bring a document: shrink a photo in the browser, then send a file in
// chunks one after another. The decisions (which file, how many chunks,
// which words) live in rules.ts; this file only does the work.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CoreError,
  failureOf,
  type HttpCoreClient,
} from "../../../lib/core/client";
import {
  UPLOAD_LIMITS,
  type SetupUpload,
} from "../../../../packages/contracts/src/setup-upload";
import {
  IMAGE_BYTES,
  SHRINK_STEPS,
  fileKind,
  fitSize,
  jpegName,
  needsSniff,
  retryOffered,
  safeName,
  senderShown,
  sizeProblem,
  slotsLeft,
  sniffKind,
  splitPlan,
  tooLong,
  type FileKind,
  type Refusal,
  type SendPhase,
  type UploadStep,
} from "./rules";

// Each chunk is tried once and then at most twice more, waiting about 1 s
// and then 4 s between tries. One try gives up after 120 s.
export const CHUNK_RETRIES = 2;
export const RETRY_WAITS = [1000, 4000] as const;
export const ATTEMPT_MS = 120_000;
// Creating an upload gives up after 30 s, finishing one after 60 s. Either
// then fails as no answer (Retry offered); the client keeps the request's
// idempotency key, so sending it again is safe.
export const CREATE_MS = 30_000;
export const FINISH_MS = 60_000;

export type SendResult = {
  // The first chunk not yet stored; equal to the chunk count when all are.
  next: number;
  // Chunk writes attempted for this upload so far, re-sends included.
  writes: number;
  error?: unknown;
  stopped?: boolean;
};

// Waits `ms`, or rejects at once when `signal` aborts.
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((done, fail) => {
    if (signal?.aborted) return fail(new Error("ABORTED"));
    const t = setTimeout(done, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        fail(new Error("ABORTED"));
      },
      { once: true },
    );
  });
}

// Runs one request with its own abort signal, which `signal` (the job's)
// and a `ms` timer both abort. The timer rejects as "TIMEOUT" (no answer,
// worth retrying), the job's signal as "ABORTED". The race moves on even if
// the request ignores its signal.
export async function within<T>(
  ms: number,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw new Error("ABORTED");
  const attempt = new AbortController();
  const stop = () => attempt.abort();
  signal?.addEventListener("abort", stop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(attempt.signal),
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => {
          // Rejects as a timeout first; the abort then only stops the
          // request.
          fail(new Error("TIMEOUT"));
          attempt.abort();
        }, ms);
        attempt.signal.addEventListener(
          "abort",
          () => fail(new Error("ABORTED")),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

// Sends chunks `from` onwards, in order. A failed chunk is sent again (same
// bytes; the client keeps its idempotency key) up to CHUNK_RETRIES times
// when the failure is worth retrying; a try that takes longer than
// `attemptMs` counts as no answer. Then it stops so the owner can Retry,
// which calls this again from the failed chunk. Never more than 30 writes
// for one upload, counted here so a refused write still counts. An aborted
// `signal` (the upload was removed, the screen closed) stops at once, also
// in the middle of a try or a wait.
export async function sendChunks(o: {
  blob: Blob;
  sizes: readonly number[];
  from: number;
  writes: number;
  put: (seq: number, bytes: Blob, signal: AbortSignal) => Promise<unknown>;
  onChunk?: (seq: number) => void;
  signal?: AbortSignal;
  attemptMs?: number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<SendResult> {
  const wait = o.wait ?? pause;
  const attemptMs = o.attemptMs ?? ATTEMPT_MS;
  let writes = o.writes;
  let offset = o.sizes.slice(0, o.from).reduce((a, b) => a + b, 0);
  for (let seq = o.from; seq < o.sizes.length; seq++) {
    const bytes = o.blob.slice(offset, offset + o.sizes[seq]);
    for (let tries = 0; ; tries++) {
      if (o.signal?.aborted) return { next: seq, writes, stopped: true };
      if (writes >= UPLOAD_LIMITS.chunkWrites)
        return { next: seq, writes, error: new CoreError("UPLOAD_RATE", 429) };
      o.onChunk?.(seq);
      writes++;
      try {
        await within(attemptMs, o.signal, (signal) =>
          o.put(seq, bytes, signal),
        );
        break;
      } catch (error) {
        if (o.signal?.aborted) return { next: seq, writes, stopped: true };
        const f = failureOf(error);
        if (!retryOffered(f.status, f.code) || tries >= CHUNK_RETRIES)
          return { next: seq, writes, error };
        try {
          await wait(RETRY_WAITS[tries] ?? 4000, o.signal);
        } catch {
          return { next: seq, writes, stopped: true };
        }
      }
    }
    offset += o.sizes[seq];
  }
  return { next: o.sizes.length, writes };
}

type Decoded = {
  width: number;
  height: number;
  image: CanvasImageSource;
  close: () => void;
};

// Decodes with the photo's own orientation. createImageBitmap first; an
// <img> element (which also applies the orientation) when that fails, for
// example on browsers that decode HEIC only in an image element.
async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        width: b.width,
        height: b.height,
        image: b,
        close: () => b.close(),
      };
    } catch {
      // Fall through to the image element.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      image: img,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

// A JPEG of at most IMAGE_BYTES, longest side at most 2,400 px, trying the
// SHRINK_STEPS in order. Re-encoding also drops the photo's metadata
// (location, camera). "unsupported" when the browser cannot decode it;
// "too_long" for a very long screenshot, which shrinking makes unreadable.
export async function shrinkImage(
  file: Blob,
): Promise<Blob | "unsupported" | "too_big" | "too_long"> {
  const src = await decode(file);
  if (!src) return "unsupported";
  const canvas = document.createElement("canvas");
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx || !src.width || !src.height) return "unsupported";
    if (tooLong(src.width, src.height)) return "too_long";
    let side = 0;
    for (const step of SHRINK_STEPS) {
      if (step.side !== side) {
        side = step.side;
        const [width, height] = fitSize(src.width, src.height, side);
        canvas.width = width;
        canvas.height = height;
        // JPEG has no transparency: a see-through screenshot turns white,
        // not black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src.image, 0, 0, width, height);
      }
      const blob = await new Promise<Blob | null>((done) =>
        canvas.toBlob(done, "image/jpeg", step.quality),
      );
      if (!blob) return "unsupported";
      if (blob.size <= IMAGE_BYTES) return blob;
    }
    return "too_big";
  } finally {
    src.close();
    // Frees the canvas memory at once (iOS Safari caps it).
    canvas.width = 0;
    canvas.height = 0;
  }
}

// The kind of a picked file: by name and type, else (no type and no
// extension) by its first 16 bytes.
async function kindOf(file: File): Promise<FileKind | null> {
  const byName = fileKind(file.name, file.type);
  if (byName || !needsSniff(file.name, file.type)) return byName;
  try {
    return sniffKind(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  } catch {
    return null;
  }
}

// A row this browser added: waiting its turn, being prepared or sent, or
// stopped. Rows are kept above the stage screens, so sending goes on after
// the owner continues.
export type Sender = {
  // The row's key for its whole life, also after the server lists it.
  key: string;
  name: string;
  uploadId: string | null;
  phase: SendPhase;
  // The chunk being sent (from 0) and the chunk count.
  seq: number;
  total: number;
  error: unknown;
  // The request that failed, for the sentence.
  step: UploadStep | null;
};
// A refusal or failed request, by file name when there is one.
export type UploadNotice = {
  name?: string;
  names?: string[];
  refusal?: Refusal | "NO_ROOM";
  error?: unknown;
  step?: UploadStep;
};
export type UploadManager = {
  senders: Sender[];
  problems: UploadNotice[];
  addFiles: (files: File[]) => Promise<void>;
  retry: (key: string) => void;
  remove: (row: { key: string; uploadId: string | null }) => Promise<boolean>;
  paste: (text: string) => Promise<boolean>;
  // The stable row key of an upload this browser added.
  rowKey: (uploadId: string) => string;
};

type Job = {
  key: string;
  name: string;
  file: File;
  kind: Exclude<FileKind, "excel">;
  uploadId: string | null;
  blob: Blob | null;
  sizes: number[];
  // The prepared file (a shrunk photo), kept so a Retry after a failed
  // create sends the same bytes with the same idempotency key.
  prepared: { blob: Blob; name: string; mime: string } | null;
  next: number;
  writes: number;
  controller: AbortController;
  removed: boolean;
};

// Waits for `request` until `signal` aborts; then rejects at once with
// "ABORTED", and a request that still succeeds is handed to `late`.
export function untilAborted<T>(
  request: Promise<T>,
  signal: AbortSignal,
  late: (value: T) => void,
): Promise<T> {
  if (signal.aborted) {
    request.then(late, () => undefined);
    return Promise.reject(new Error("ABORTED"));
  }
  return new Promise<T>((done, fail) => {
    const stop = () => {
      request.then(late, () => undefined);
      fail(new Error("ABORTED"));
    };
    signal.addEventListener("abort", stop, { once: true });
    request.then(
      (v) => {
        signal.removeEventListener("abort", stop);
        done(v);
      },
      (e) => {
        signal.removeEventListener("abort", stop);
        fail(e);
      },
    );
  });
}

class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal);
  }
}

export function useUploadManager(o: {
  client: HttpCoreClient;
  agentId: string;
  uploads: SetupUpload[];
  // Shows a known change to one upload at once (created, finished, pasted,
  // removed) and keeps it over older views until the server agrees.
  hold: (id: string, upload: SetupUpload | "removed") => void;
  // Reads the view again without showing an error; a failure waits for
  // the next read.
  refresh: () => Promise<void>;
}): UploadManager {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [problems, setProblems] = useState<UploadNotice[]>([]);
  const jobs = useRef(new Map<string, Job>());
  const queue = useRef<string[]>([]);
  const looping = useRef(false);
  const keys = useRef(new Map<string, string>());
  const opts = useRef(o);
  opts.current = o;
  const latestSenders = useRef(senders);
  latestSenders.current = senders;

  const update = useCallback((key: string, patch: Partial<Sender>) => {
    setSenders((all) =>
      all.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  }, []);
  const drop = useCallback((key: string) => {
    jobs.current.delete(key);
    setSenders((all) => all.filter((s) => s.key !== key));
  }, []);
  const hold = useCallback(
    (id: string, upload: SetupUpload | "removed") =>
      opts.current.hold(id, upload),
    [],
  );
  const problem = useCallback(
    (n: UploadNotice) => setProblems((all) => [...all, n]),
    [],
  );

  // Once the server lists an upload past "uploading", its own label wins:
  // the local row (even "Sending failed") is dropped.
  const { uploads } = o;
  useEffect(() => {
    const past = (id: string | null) =>
      !!id && !senderShown(uploads.find((u) => u.id === id));
    for (const [key, j] of jobs.current)
      if (past(j.uploadId)) jobs.current.delete(key);
    setSenders((all) => {
      const next = all.filter((s) => !past(s.uploadId));
      return next.length === all.length ? all : next;
    });
  }, [uploads]);

  // Leaving the screen stops every send and empties the queue, so no file
  // waiting its turn is prepared or created afterwards (a create already in
  // flight is deleted when it lands). Leaving the page while a file is
  // still being prepared or sent asks first.
  useEffect(() => {
    const all = jobs.current;
    const waiting = queue;
    return () => {
      waiting.current = [];
      for (const j of all.values()) {
        j.removed = true;
        j.controller.abort();
      }
    };
  }, []);
  const busy = senders.some((s) =>
    ["waiting", "preparing", "sending"].includes(s.phase),
  );
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // Sends one job's chunks and finishes it.
  const send = useCallback(
    async (job: Job) => {
      const { client, agentId } = opts.current;
      const uploadId = job.uploadId!;
      update(job.key, { phase: "sending", error: null, step: null });
      const sent = await sendChunks({
        blob: job.blob!,
        sizes: job.sizes,
        from: job.next,
        writes: job.writes,
        put: (seq, bytes, signal) =>
          client.putChunk({ id: agentId, uploadId, seq }, bytes, signal),
        onChunk: (seq) => update(job.key, { seq }),
        signal: job.controller.signal,
      });
      job.next = sent.next;
      job.writes = sent.writes;
      if (job.removed || sent.stopped) return;
      if (sent.error) {
        update(job.key, { phase: "failed", error: sent.error, step: "chunk" });
        return;
      }
      let finished: SetupUpload;
      try {
        finished = await within(FINISH_MS, job.controller.signal, (signal) =>
          client.execute(
            "finishSetupUpload",
            { id: agentId, uploadId },
            undefined,
            signal,
          ),
        );
      } catch (e) {
        if (job.removed) return;
        // A refused file is removed on the server: its row goes, and the
        // reason is listed by name.
        if (
          e instanceof CoreError &&
          (e.code === "UPLOAD_XLSX" || e.code === "UPLOAD_TYPE")
        ) {
          drop(job.key);
          hold(uploadId, "removed");
          problem({ name: job.name, error: e, step: "finish" });
          void opts.current.refresh();
          return;
        }
        update(job.key, { phase: "failed", error: e, step: "finish" });
        return;
      }
      if (job.removed) return;
      update(job.key, { phase: "sent", error: null, step: null });
      hold(finished.id, finished);
      void opts.current.refresh();
    },
    [update, drop, hold, problem],
  );

  // Prepares (shrinks a photo), creates and sends one job. A refusal drops
  // the row and is listed by name; any other error leaves the row failed,
  // and the batch goes on.
  const runJob = useCallback(
    async (job: Job) => {
      const { client, agentId } = opts.current;
      try {
        if (!job.uploadId) {
          update(job.key, { phase: "preparing", error: null, step: null });
          if (!job.prepared) {
            let blob: Blob = job.file,
              name = job.name;
            let mime =
              job.file.type ||
              (job.kind === "pdf"
                ? "application/pdf"
                : job.kind === "image"
                  ? "image/jpeg"
                  : "text/csv");
            if (job.kind === "image") {
              const small = await shrinkImage(job.file);
              if (typeof small === "string")
                throw new Refused(
                  small === "unsupported"
                    ? "PHOTO_FORMAT"
                    : small === "too_long"
                      ? "PHOTO_TOO_LONG"
                      : "PHOTO_TOO_BIG",
                );
              blob = small;
              name = jpegName(job.file.name);
              mime = "image/jpeg";
            }
            job.prepared = { blob, name, mime: mime.slice(0, 100) };
          }
          const { blob, name, mime } = job.prepared;
          const sizes = splitPlan(blob.size);
          if (!sizes.length) throw new Refused(blob.size ? "SPLIT" : "EMPTY");
          // Removed, or the screen closed, while it was being prepared.
          if (job.removed || job.controller.signal.aborted) return;
          const input = { id: agentId, kind: job.kind, name, mime, bytes: blob.size };
          // Only the timer stops the create request itself: a removal (or
          // the screen closing) stops waiting at once, and a create that
          // still lands is deleted, so no orphan "uploading" row keeps a
          // place.
          const orphan = (u: SetupUpload) =>
            void client
              .execute("removeSetupUpload", { id: agentId, uploadId: u.id })
              .catch(() => undefined);
          const create = (key?: string) =>
            untilAborted(
              within(CREATE_MS, undefined, (signal) =>
                client.execute("createSetupUpload", input, key, signal),
              ),
              job.controller.signal,
              orphan,
            );
          let created: SetupUpload;
          try {
            created = await create();
            // A replayed create (same file, same key after a lost answer)
            // can return an upload that was removed since: make a new one.
            if (created.state !== "uploading")
              created = await create(crypto.randomUUID());
          } catch (e) {
            if (job.removed) return;
            update(job.key, { phase: "failed", error: e, step: "create" });
            return;
          }
          keys.current.set(created.id, job.key);
          if (job.removed) {
            // Removed while it was being created.
            orphan(created);
            return;
          }
          Object.assign(job, { uploadId: created.id, blob, sizes });
          update(job.key, { uploadId: created.id, total: sizes.length });
          hold(created.id, created);
        }
        await send(job);
      } catch (e) {
        if (job.removed) return;
        if (e instanceof Refused) {
          drop(job.key);
          problem({ name: job.name, refusal: e.refusal });
          return;
        }
        // Preparing the file broke (not a request): the general sentence,
        // no Retry.
        update(job.key, { phase: "failed", error: e, step: null });
      }
    },
    [update, drop, hold, problem, send],
  );

  // One queue for every pick and every Retry: one file at a time.
  const pump = useCallback(async () => {
    if (looping.current) return;
    looping.current = true;
    try {
      for (let key = queue.current.shift(); key; key = queue.current.shift()) {
        const job = jobs.current.get(key);
        if (job && !job.removed) await runJob(job);
      }
    } finally {
      looping.current = false;
    }
  }, [runJob]);

  const addFiles = useCallback(
    async (files: File[]) => {
      setProblems([]);
      const ready: { file: File; name: string; kind: Job["kind"] }[] = [];
      const refusals: UploadNotice[] = [];
      for (const file of files) {
        const name = safeName(file.name);
        const kind = await kindOf(file);
        if (kind === "excel") refusals.push({ name, refusal: "EXCEL" });
        else if (!kind) refusals.push({ name, refusal: "TYPE" });
        else {
          const size = sizeProblem(kind, file.size);
          if (size) refusals.push({ name, refusal: size });
          else ready.push({ file, name, kind });
        }
      }
      // Places left: the server's uploads plus rows not yet listed there.
      const listed = opts.current.uploads;
      const used =
        listed.length +
        latestSenders.current.filter(
          (s) => !s.uploadId || !listed.some((u) => u.id === s.uploadId),
        ).length;
      const room = slotsLeft(used);
      const extra = ready.splice(room);
      if (extra.length)
        refusals.push({ refusal: "NO_ROOM", names: extra.map((f) => f.name) });
      setProblems(refusals);
      if (!ready.length) return;
      const rows: Sender[] = [];
      for (const f of ready) {
        const key = crypto.randomUUID();
        jobs.current.set(key, {
          key,
          name: f.name,
          file: f.file,
          kind: f.kind,
          uploadId: null,
          blob: null,
          sizes: [],
          prepared: null,
          next: 0,
          writes: 0,
          controller: new AbortController(),
          removed: false,
        });
        rows.push({
          key,
          name: f.name,
          uploadId: null,
          phase: "waiting",
          seq: 0,
          total: 0,
          error: null,
          step: null,
        });
        queue.current.push(key);
      }
      setSenders((all) => [...all, ...rows]);
      await pump();
    },
    [pump],
  );

  const retry = useCallback(
    (key: string) => {
      const job = jobs.current.get(key);
      if (!job || job.removed || queue.current.includes(key)) return;
      update(key, { phase: "waiting", error: null, step: null });
      queue.current.push(key);
      void pump();
    },
    [update, pump],
  );

  // The screen's name of a listed upload, for a notice about it.
  const nameOf = (uploadId: string) => {
    const u = opts.current.uploads.find((x) => x.id === uploadId);
    return u ? (u.kind === "text" ? undefined : u.name) : undefined;
  };

  const remove = useCallback(
    async (row: { key: string; uploadId: string | null }) => {
      const { client, agentId } = opts.current;
      setProblems([]);
      const job = jobs.current.get(row.key);
      const uploadId = row.uploadId ?? job?.uploadId ?? null;
      if (job) {
        job.removed = true;
        job.controller.abort();
        queue.current = queue.current.filter((k) => k !== row.key);
      }
      if (uploadId) {
        try {
          await client.execute("removeSetupUpload", { id: agentId, uploadId });
        } catch (e) {
          // Already gone is what the owner asked for.
          if (!(e instanceof CoreError && e.status === 404)) {
            // The send stays stopped: the row offers to remove again,
            // never to send the file the owner asked to remove.
            if (job)
              update(row.key, { phase: "failed", error: e, step: "remove" });
            else problem({ name: nameOf(uploadId), error: e, step: "remove" });
            return false;
          }
        }
        hold(uploadId, "removed");
        void opts.current.refresh();
      }
      drop(row.key);
      return true;
    },
    [update, drop, hold, problem],
  );

  const paste = useCallback(
    async (text: string) => {
      const { client, agentId } = opts.current;
      setProblems([]);
      try {
        const created = await client.execute("pasteSetupText", {
          id: agentId,
          text,
        });
        hold(created.id, created);
        void opts.current.refresh();
        return true;
      } catch (e) {
        problem({ error: e, step: "paste" });
        return false;
      }
    },
    [hold, problem],
  );

  const rowKey = useCallback(
    (uploadId: string) => keys.current.get(uploadId) ?? uploadId,
    [],
  );

  return { senders, problems, addFiles, retry, remove, paste, rowKey };
}
