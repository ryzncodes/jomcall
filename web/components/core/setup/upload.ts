// Bring a document: shrink a photo in the browser, then send a file in
// chunks one after another. The decisions (which file, how many chunks,
// which words) live in rules.ts; this file only does the work.
import { useCallback, useEffect, useRef, useState } from "react";
import { CoreError, type HttpCoreClient } from "../../../lib/core/client";
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
  retryable,
  safeName,
  sizeProblem,
  splitPlan,
  type Refusal,
  type SendPhase,
} from "./rules";

// Each chunk is tried once and then at most twice more.
export const CHUNK_RETRIES = 2;

export type SendResult = {
  // The first chunk not yet stored; equal to the chunk count when all are.
  next: number;
  // Chunk writes attempted for this upload so far, re-sends included.
  writes: number;
  error?: unknown;
  stopped?: boolean;
};

// Sends chunks `from` onwards, in order. A failed chunk is sent again (same
// bytes; the client keeps its idempotency key) up to CHUNK_RETRIES times
// when the failure is worth retrying; then it stops so the owner can Retry,
// which calls this again from the failed chunk. Never more than 30 writes
// for one upload, counted here so a refused write still counts.
export async function sendChunks(o: {
  blob: Blob;
  sizes: readonly number[];
  from: number;
  writes: number;
  put: (seq: number, bytes: Blob) => Promise<unknown>;
  onChunk?: (seq: number) => void;
  stopped?: () => boolean;
}): Promise<SendResult> {
  let writes = o.writes;
  let offset = o.sizes.slice(0, o.from).reduce((a, b) => a + b, 0);
  for (let seq = o.from; seq < o.sizes.length; seq++) {
    const bytes = o.blob.slice(offset, offset + o.sizes[seq]);
    for (let tries = 0; ; tries++) {
      if (o.stopped?.()) return { next: seq, writes, stopped: true };
      if (writes >= UPLOAD_LIMITS.chunkWrites)
        return { next: seq, writes, error: new CoreError("UPLOAD_RATE", 429) };
      o.onChunk?.(seq);
      writes++;
      try {
        await o.put(seq, bytes);
        break;
      } catch (error) {
        const status = error instanceof CoreError ? error.status : null;
        if (!retryable(status) || tries >= CHUNK_RETRIES)
          return { next: seq, writes, error };
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
// (location, camera). "unsupported" when the browser cannot decode it.
export async function shrinkImage(
  file: Blob,
): Promise<Blob | "unsupported" | "too_big"> {
  const src = await decode(file);
  if (!src) return "unsupported";
  const canvas = document.createElement("canvas");
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx || !src.width || !src.height) return "unsupported";
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

// A file this browser is sending (or preparing, or failed to send). Kept
// above the stage screens, so sending goes on after the owner continues.
export type Sender = {
  key: string;
  name: string;
  uploadId: string | null;
  phase: SendPhase;
  // The chunk being sent (from 0) and the chunk count.
  seq: number;
  total: number;
  error: unknown;
};
export type UploadStep = "create" | "chunk" | "finish" | "paste" | "remove";
// The last refusal or failed request, shown once above the file button.
export type UploadNotice = {
  name?: string;
  refusal?: Refusal;
  error?: unknown;
  step?: UploadStep;
};
export type UploadManager = {
  senders: Sender[];
  notice: UploadNotice | null;
  clearNotice: () => void;
  addFiles: (files: File[]) => Promise<void>;
  retry: (key: string) => void;
  remove: (uploadId: string) => Promise<boolean>;
  paste: (text: string) => Promise<boolean>;
};

type Job = {
  uploadId: string;
  name: string;
  blob: Blob;
  sizes: number[];
  next: number;
  writes: number;
  cancelled: boolean;
  running: boolean;
};

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
  const [notice, setNotice] = useState<UploadNotice | null>(null);
  const jobs = useRef(new Map<string, Job>());
  const opts = useRef(o);
  opts.current = o;

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

  // A sent file's row follows the server once the view no longer shows it
  // as uploading.
  const { uploads } = o;
  useEffect(() => {
    setSenders((all) => {
      const next = all.filter(
        (s) =>
          s.phase !== "sent" ||
          uploads.some((u) => u.id === s.uploadId && u.state === "uploading"),
      );
      return next.length === all.length ? all : next;
    });
  }, [uploads]);

  const run = useCallback(
    async (key: string) => {
      const job = jobs.current.get(key);
      if (!job || job.running) return;
      const { client, agentId } = opts.current;
      job.running = true;
      job.cancelled = false;
      update(key, { phase: "sending", error: null });
      try {
        const sent = await sendChunks({
          blob: job.blob,
          sizes: job.sizes,
          from: job.next,
          writes: job.writes,
          put: (seq, bytes) =>
            client.putChunk({ id: agentId, uploadId: job.uploadId, seq }, bytes),
          onChunk: (seq) => update(key, { seq }),
          stopped: () => job.cancelled,
        });
        job.next = sent.next;
        job.writes = sent.writes;
        if (job.cancelled) return;
        if (sent.error) {
          update(key, { phase: "failed", error: sent.error });
          return;
        }
        let finished: SetupUpload;
        try {
          finished = await client.execute("finishSetupUpload", {
            id: agentId,
            uploadId: job.uploadId,
          });
        } catch (e) {
          if (job.cancelled) return;
          // A refused file is removed on the server: its row goes, and the
          // reason is shown once.
          if (
            e instanceof CoreError &&
            (e.code === "UPLOAD_XLSX" || e.code === "UPLOAD_TYPE")
          ) {
            drop(key);
            hold(job.uploadId, "removed");
            setNotice({ name: job.name, error: e, step: "finish" });
            void opts.current.refresh();
            return;
          }
          update(key, { phase: "failed", error: e });
          return;
        }
        if (job.cancelled) return;
        jobs.current.delete(key);
        update(key, { phase: "sent", error: null });
        hold(finished.id, finished);
        void opts.current.refresh();
      } finally {
        job.running = false;
      }
    },
    [update, drop, hold],
  );

  const addFile = useCallback(
    async (file: File) => {
      const { client, agentId } = opts.current;
      const kind = fileKind(file.name, file.type);
      const shown = safeName(file.name);
      if (kind === "excel")
        return setNotice({ name: shown, refusal: "EXCEL" });
      if (!kind) return setNotice({ name: shown, refusal: "TYPE" });
      const problem = sizeProblem(kind, file.size);
      if (problem) return setNotice({ name: shown, refusal: problem });
      const key = crypto.randomUUID();
      setSenders((all) => [
        ...all,
        {
          key,
          name: shown,
          uploadId: null,
          phase: "preparing",
          seq: 0,
          total: 0,
          error: null,
        },
      ]);
      let blob: Blob = file,
        name = shown,
        mime = file.type || (kind === "pdf" ? "application/pdf" : "text/csv");
      if (kind === "image") {
        const small = await shrinkImage(file);
        if (small === "unsupported" || small === "too_big") {
          drop(key);
          return setNotice({
            name: shown,
            refusal: small === "unsupported" ? "PHOTO_FORMAT" : "PHOTO_TOO_BIG",
          });
        }
        blob = small;
        name = jpegName(file.name);
        mime = "image/jpeg";
      }
      const sizes = splitPlan(blob.size);
      if (!sizes.length) {
        drop(key);
        return setNotice({
          name: shown,
          refusal: blob.size ? "SPLIT" : "EMPTY",
        });
      }
      let created: SetupUpload;
      try {
        created = await client.execute("createSetupUpload", {
          id: agentId,
          kind,
          name,
          mime: mime.slice(0, 100),
          bytes: blob.size,
        });
      } catch (e) {
        drop(key);
        return setNotice({ name: shown, error: e, step: "create" });
      }
      jobs.current.set(key, {
        uploadId: created.id,
        name: shown,
        blob,
        sizes,
        next: 0,
        writes: 0,
        cancelled: false,
        running: false,
      });
      update(key, { uploadId: created.id, total: sizes.length });
      hold(created.id, created);
      await run(key);
    },
    [drop, update, hold, run],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      setNotice(null);
      for (const f of files) await addFile(f);
    },
    [addFile],
  );

  const retry = useCallback((key: string) => void run(key), [run]);

  const remove = useCallback(
    async (uploadId: string) => {
      const { client, agentId } = opts.current;
      setNotice(null);
      const mine = [...jobs.current.values()].filter(
        (j) => j.uploadId === uploadId,
      );
      for (const j of mine) j.cancelled = true;
      try {
        await client.execute("removeSetupUpload", { id: agentId, uploadId });
      } catch (e) {
        // Already gone is what the owner asked for.
        if (!(e instanceof CoreError && e.status === 404)) {
          for (const j of mine) j.cancelled = false;
          setSenders((all) =>
            all.map((s) =>
              s.uploadId === uploadId && s.phase === "sending"
                ? { ...s, phase: "failed", error: e }
                : s,
            ),
          );
          setNotice({ error: e, step: "remove" });
          return false;
        }
      }
      for (const [k, j] of jobs.current)
        if (j.uploadId === uploadId) jobs.current.delete(k);
      setSenders((all) => all.filter((s) => s.uploadId !== uploadId));
      hold(uploadId, "removed");
      void opts.current.refresh();
      return true;
    },
    [hold],
  );

  const paste = useCallback(
    async (text: string) => {
      const { client, agentId } = opts.current;
      setNotice(null);
      try {
        const created = await client.execute("pasteSetupText", {
          id: agentId,
          text,
        });
        hold(created.id, created);
        void opts.current.refresh();
        return true;
      } catch (e) {
        setNotice({ error: e, step: "paste" });
        return false;
      }
    },
    [hold],
  );

  return {
    senders,
    notice,
    clearNotice: () => setNotice(null),
    addFiles,
    retry,
    remove,
    paste,
  };
}
