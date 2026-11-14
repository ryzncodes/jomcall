import { HOSTED } from "@/lib/hosted";
export const coreEn = {
  requested: "Awaiting confirmation",
  confirmed: HOSTED ? "Confirmed" : "Confirmed in local calendar",
  cancelled: "Cancelled",
  proposal: "Test proposal",
  local: HOSTED ? "JomCall calendar" : "Local calendar",
  empty: "No appointments here yet.",
};
