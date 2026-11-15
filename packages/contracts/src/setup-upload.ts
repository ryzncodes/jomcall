// Guided setup document import: an owner's price list, PDF, spreadsheet or
// pasted text, held in app.setup_upload / app.setup_upload_chunk until the
// agent process reads it. The client splits one file into at most 10 chunks
// of at most 3 MiB each; chunks may arrive in any order and may be re-sent.
import { z } from "zod";

export const UPLOAD_LIMITS = {
  chunkBytes: 3 * 1024 * 1024,
  chunks: 10,
  // 10 chunks of 3 MiB would be 30 MiB; the declared size caps it at 10 MiB.
  uploadBytes: 10 * 1024 * 1024,
  // Chunk writes per upload, re-sends included.
  chunkWrites: 30,
  perSession: 5,
  perOrgPerDay: 20,
  textChars: 20000,
} as const;

const codePoints = (s: string) => [...s].length;
// No control characters (C0, DEL, C1) and no bidirectional override or
// isolate characters, which could make a file name display as another.
const plain = /^[^\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/;

// The declared kind, name and mime are hints only: the stored kind and mime
// come from the leading bytes at finish. Pasted text has its own command.
export const setupUploadCreate = z
  .object({
    kind: z.enum(["image", "pdf", "sheet"]),
    name: z.string().trim().min(1).max(200).regex(plain),
    mime: z.string().trim().max(100).regex(plain),
    // Checked against the limit in the domain, so the refusal has its own code.
    bytes: z.number().int().positive(),
  })
  .strict();

export const setupPasteText = z
  .object({
    text: z
      .string()
      .refine((s) => s.trim().length > 0, { message: "Text required" })
      .refine((s) => codePoints(s) <= UPLOAD_LIMITS.textChars, {
        message: "Text too long",
      }),
  })
  .strict();

export const uploadSeq = z.coerce
  .number()
  .int()
  .min(0)
  .max(UPLOAD_LIMITS.chunks - 1);

export type SetupUploadKind = "image" | "pdf" | "sheet" | "text";
export type SetupUploadState =
  | "uploading"
  | "queued"
  | "reading"
  | "done"
  | "failed"
  | "removed";
export type SetupUpload = {
  id: string;
  kind: SetupUploadKind;
  name: string;
  bytes: number;
  state: SetupUploadState;
  failCode: string | null;
  rowCount: number;
  factCount: number;
  // Rows the reader returned that could not be used ("N rows could not be read").
  droppedCount: number;
  // When the file's bytes were deleted (30 days after upload); null while kept.
  bytesDeletedAt: string | null;
  createdAt: string;
};
