import { queueNamespace } from "../../contracts/src/hosting.ts";
import { AppError, type TenantContext } from "../../contracts/src/index.ts";
export function manager(ctx: TenantContext) {
  if (ctx.role === "staff") throw new AppError("FORBIDDEN", 403);
}
// `local` unless configured; `staging` or `prod` in hosted mode.
export function namespace() {
  return queueNamespace();
}
