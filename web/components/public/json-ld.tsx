import { ldScriptText, type LdNode } from "@/lib/json-ld";

// One structured-data script. Renders nothing when there is no data (mock and
// local mode have no origin to point at).
export function JsonLd({ data }: { data: LdNode | null }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScriptText(data) }} />;
}
