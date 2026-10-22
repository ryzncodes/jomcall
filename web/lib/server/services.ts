import "server-only";
import { Database } from "../../../packages/db/src/index.ts";
import { requireLocal } from "./config.ts";
let db: Database | undefined;
export function database() {
  requireLocal();
  return (db ??= new Database(process.env.APP_DATABASE_URL!));
}
export async function closeServices() {
  await db?.close();
  db = undefined;
}
