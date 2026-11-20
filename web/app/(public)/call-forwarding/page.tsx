import type { Metadata } from "next";
import { CallForwardingPage } from "@/components/public/pages/call-forwarding";
import { forwarding } from "@/content/public/call-forwarding";
import { pageMetadata } from "@/lib/public-meta";

export const metadata: Metadata = pageMetadata("call-forwarding", "en", forwarding.en.page);

export default function Page() {
  return <CallForwardingPage locale="en" />;
}
