import { AppError, type TenantContext } from "../../contracts/src/index.ts";
export function manager(ctx: TenantContext) {
  if (ctx.role === "staff") throw new AppError("FORBIDDEN", 403);
}
export function namespace() {
  const n = process.env.JOMCALL_QUEUE_NAMESPACE ?? "local";
  if (
    n !== "local" &&
    !(process.env.NODE_ENV === "test" && /^test_[a-f0-9-]{36}$/.test(n))
  )
    throw Error("INVALID_QUEUE_NAMESPACE");
  return n;
}
