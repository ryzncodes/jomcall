import { HOSTED } from "@/lib/hosted";
import type { coreEn } from "./core-en";
export const coreMs = {
  requested: "Menunggu pengesahan",
  confirmed: HOSTED ? "Disahkan" : "Disahkan dalam kalendar setempat",
  cancelled: "Dibatalkan",
  proposal: "Cadangan ujian",
  local: HOSTED ? "Kalendar JomCall" : "Kalendar setempat",
  empty: "Belum ada janji temu di sini.",
} satisfies Record<keyof typeof coreEn, string>;
