import type { coreEn } from "./core-en";
export const coreMs = {
  requested: "Menunggu pengesahan",
  confirmed: "Disahkan dalam kalendar setempat",
  cancelled: "Dibatalkan",
  proposal: "Cadangan ujian",
  local: "Kalendar setempat",
  empty: "Belum ada janji temu di sini.",
} satisfies Record<keyof typeof coreEn, string>;
