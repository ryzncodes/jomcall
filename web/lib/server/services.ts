import "server-only";
import { Database } from "../../../packages/db/src/index.ts";
import { requireApp } from "./config.ts";
let db: Database | undefined;
export function database() {
  requireApp();
  return (db ??= new Database(process.env.APP_DATABASE_URL!));
}
export async function closeServices() {
  await db?.close();
  db = undefined;
}
