import { llmsText } from "../../lib/llms";
import { isIndexable } from "../../lib/site";

export const dynamic = "force-static";

// A plain-text summary for language models. Served only on the real site.
export function GET() {
  if (!isIndexable()) return new Response("Not found", { status: 404 });
  return new Response(llmsText(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
