import { FORWARD_CODES, forwarding } from "@/content/public/call-forwarding";
import type { PublicLocale } from "@/lib/site";

// The app's forwarding code pairs as a dark card of keys, with what
// each one does. Shared by the call forwarding page and the forwarding guide,
// so the codes are typed in one place (FORWARD_CODES).
export function CodesCard({ locale }: { locale: PublicLocale }) {
  const codes = forwarding[locale].codes;
  return (
    <>
      <ol className="codes-card">
        {FORWARD_CODES.map((code, i) => (
          <li key={code.id} className="code-item">
            <div className="code-text">
              <h3 className="t-h3">{codes.rows[i].name}</h3>
              <p className="t-small t-muted">{codes.rows[i].when}</p>
            </div>
            <dl className="code-keys">
              <div>
                <dt className="t-label t-muted">{codes.start}</dt>
                <dd>
                  <code className="key t-data">{code.start}</code>
                  <var className="key-slot">{codes.number}</var>
                  <code className="key t-data">#</code>
                </dd>
              </div>
              <div>
                <dt className="t-label t-muted">{codes.stop}</dt>
                <dd>
                  <code className="key t-data">{code.stop}</code>
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <p className="t-small t-muted codes-note">{codes.note}</p>
    </>
  );
}
