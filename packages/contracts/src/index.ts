import { z } from "zod";
export type Role = "owner" | "admin" | "staff";
export type Identity = {
  userId: string;
  sessionId: string;
  confirmedEmail: string;
};
export type TenantContext = { identity: Identity; orgId: string; role: Role };
export type MutationMeta = { idempotencyKey: string };
export const uuid = z.uuid();
export const name = z.string().trim().min(1).max(120);
export const organizationInput = z
  .object({
    name,
    businessType: z.string().min(1).max(80),
    primaryLocationName: name,
  })
  .strict();
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number = 400,
  ) {
    super(code);
  }
}
