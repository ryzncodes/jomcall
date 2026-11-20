import type { FaqItem } from "@/content/public/types";

// Questions and answers as native disclosures: readable and searchable
// without script, and every answer is in the HTML even when closed. The
// question is the summary's own text (a heading inside <summary> loses its
// heading role in most screen readers); the group above names the topic
// with its own heading.
export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="faq-list">
      {items.map((item) => (
        <details key={item.q} className="faq-item">
          <summary>
            <span className="faq-q">{item.q}</span>
            <span className="faq-sign" aria-hidden="true" />
          </summary>
          <p className="t-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
