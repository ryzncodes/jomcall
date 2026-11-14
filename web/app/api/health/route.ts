import { handleHealth } from "@/lib/server/health";
export const dynamic = "force-dynamic";
export const GET = () => handleHealth();
