import { z } from "zod";
import { name } from "./index.ts";
export const contactFields = {
  name,
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{1,14}$/)
    .nullable(),
  preferredLanguage: z.enum(["ms", "en", "zh"]),
};
export const contactInput = z.object(contactFields).strict();
export const contactUpdate = z
  .object({ ...contactFields, expectedRevision: z.number().int().positive() })
  .strict();
export const noteInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    text: z.string().trim().min(1).max(5000),
  })
  .strict();
export const consentInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    channel: z.enum(["phone", "whatsapp"]),
    purpose: z.enum(["service", "marketing"]),
    granted: z.boolean(),
    source: z.string().trim().min(1).max(2000),
    evidence: z.string().trim().min(1).max(2000),
  })
  .strict();
export const dncInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
