import { handleBillingWebhook } from "@/lib/server/billing-webhook";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  return handleBillingWebhook(request, (await params).provider);
}
