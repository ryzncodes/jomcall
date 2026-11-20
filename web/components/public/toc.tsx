// The in-page contents list. On a wide screen it is a sticky list beside the
// text; on a phone it folds into a disclosure at the top, so the text starts
// on the first screen. Both are in the HTML and CSS shows one, because a
// closed <details> cannot be forced open on desktop in every browser.
// A server component: no script.
export type TocItem = { id: string; heading: string };

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Toc({ label, items }: { label: string; items: TocItem[] }) {
  const list = (
    <ol className="toc-list">
      {items.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`}>{item.heading}</a>
        </li>
      ))}
    </ol>
  );
  return (
    <nav className="toc" aria-label={label}>
      <details className="toc-phone">
        <summary>
          <span>{label}</span>
          <Chevron />
        </summary>
        {list}
      </details>
      <div className="toc-wide">
        <p className="t-label t-muted">{label}</p>
        {list}
      </div>
    </nav>
  );
}
