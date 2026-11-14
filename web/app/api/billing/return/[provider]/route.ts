import { handleBillingReturn } from "@/lib/server/billing-webhook";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ provider: string }> };
export async function POST(request: Request, { params }: Params) {
  return handleBillingReturn(request, (await params).provider);
}
export async function GET(request: Request, { params }: Params) {
  return handleBillingReturn(request, (await params).provider);
}
