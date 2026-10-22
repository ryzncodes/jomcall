import { z } from "zod";
import { name } from "./index.ts";
export const agentSettings = z
  .object({
    name,
    languages: z
      .array(z.enum(["ms", "en", "zh"]))
      .min(1)
      .max(3)
      .refine((x) => new Set(x).size === x.length),
    manglish: z.boolean(),
    greeting: z.string().max(2000),
    instructions: z.string().max(20000),
    aiDisclosure: z.string().max(2000),
    recordingEnabled: z.boolean(),
    recordingDisclosure: z.string().max(2000),
    voicePreference: z.string().max(120),
  })
  .strict();
const start = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end = z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/);
const interval = z
  .object({ start, end })
  .strict()
  .refine((x) => x.end > x.start, { message: "End must follow start" });
export const scheduleInput = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    timezone: z.string().refine((x) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: x });
        return true;
      } catch {
        return false;
      }
    }),
    weekdays: z
      .array(
        z
          .array(interval)
          .max(4)
          .refine(
            (xs) => xs.every((v, i) => i === 0 || v.start >= xs[i - 1].end),
            { message: "Intervals must be ordered without overlap" },
          ),
      )
      .length(7),
    closures: z
      .array(
        z
          .object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .refine((x) => {
                const d = new Date(x + "T00:00:00Z");
                return !isNaN(+d) && d.toISOString().slice(0, 10) === x;
              }),
            reason: z.string().max(300),
          })
          .strict(),
      )
      .max(366)
      .refine((xs) => new Set(xs.map((x) => x.date)).size === xs.length),
  })
  .strict();
export const knowledgeInput = z
  .object({
    id: z.uuid().optional(),
    expectedAgentRevision: z.number().int().positive(),
    kind: z.enum(["faq", "services", "text-document"]),
    name,
    content: z
      .string()
      .max(100000)
      .refine(
        (x) =>
          !x.includes("\0") &&
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            x,
          ) &&
          new TextEncoder().encode(x).length <= 100000,
      ),
    filename: z
      .string()
      .regex(/\.(txt|md)$/i)
      .optional(),
  })
  .strict()
  .refine((x) => x.kind !== "text-document" || !!x.filename, {
    message: "Text documents require a .txt or .md filename",
  });
