import type { HomeCopy, SampleVoice } from "@/content/public/home";

// The bento under the hero (spec 6.3, item 2): each tile is a small view of
// JomCall itself, filled with made-up data, never an icon and a sentence.

function Check() {
  return (
    <svg className="b-check" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Bento({
  copy,
  voices,
}: {
  copy: HomeCopy["bento"];
  voices: SampleVoice[];
}) {
  const { calls, booking, price, forward, transfer, languages, honest } = copy;
  return (
    <div className="bento">
      <article className="tile tile-calls">
        <header className="tile-head">
          <h3 className="t-h3">{calls.title}</h3>
          <span className="t-label tile-note">{calls.note}</span>
        </header>
        <ul className="calls-list">
          {calls.rows.map((row) => (
            <li key={row.name} className="call-row">
              <span className="call-time t-data">{row.time}</span>
              <span className="call-who">
                <span className="call-name">{row.name}</span>
                <span className="call-meta t-label">
                  <span className="call-time t-data">{row.time}</span>
                  <span aria-hidden="true">·</span>
                  <span lang={row.lang === "中文" ? "zh" : undefined}>{row.lang}</span>
                  <span aria-hidden="true">·</span>
                  <span className="t-data">{row.length}</span>
                </span>
              </span>
              <span className={`badge${row.kind === "booked" ? " badge-solid" : ""}`}>{row.outcome}</span>
            </li>
          ))}
        </ul>
        <p className="tile-foot t-small calls-summary">
          {calls.summary(
            calls.rows.length,
            calls.rows.filter((r) => r.kind === "booked").length,
            calls.rows.filter((r) => r.kind === "message").length,
          )}
        </p>
      </article>

      <article className="tile tile-booking">
        <h3 className="t-h3">{booking.title}</h3>
        <div className="booking-slip">
          <div className="slip-when">
            <span className="t-label">{booking.day}</span>
            <strong className="t-data">{booking.time}</strong>
          </div>
          <div className="slip-what">
            <span className="t-small">{booking.service}</span>
            <q className="slip-quote">{booking.quote}</q>
          </div>
        </div>
        <p className="tile-foot t-small">
          <Check />
          {booking.note}
        </p>
      </article>

      <article className="tile tile-price">
        <p className="price-amount t-data">{price.amount}</p>
        <p className="t-small">{price.body}</p>
        <div className="usage">
          <span className="t-label t-muted">{price.usageLabel}</span>
          <span className="usage-bar" aria-hidden="true">
            <i style={{ width: "38%" }} />
          </span>
          <span className="t-small">{price.usage}</span>
        </div>
        <p className="tile-foot t-label">{price.note}</p>
      </article>

      <article className="tile tile-honest">
        <h3 className="t-h3">{honest.title}</h3>
        <ul className="honest-list">
          {honest.rows.map((row) => (
            <li key={row} className="t-small">
              <Check />
              {row}
            </li>
          ))}
        </ul>
      </article>

      <article className="tile tile-forward">
        <h3 className="t-h3">{forward.title}</h3>
        <p className="t-small tile-body">{forward.body}</p>
        <dl className="codes">
          {forward.rows.map((row) => (
            <div key={row.code} className="code-row">
              <dt className="t-data">{row.code}</dt>
              <dd className="t-small">{row.meaning}</dd>
            </div>
          ))}
        </dl>
      </article>

      <article className="tile tile-transfer">
        <h3 className="t-h3">{transfer.title}</h3>
        <ul className="hours">
          <li className="hours-row">
            <span className="hours-state hours-open t-label">{transfer.open}</span>
            <span className="t-data hours-time">{transfer.openTime}</span>
            <span className="hours-result t-small">{transfer.openResult}</span>
          </li>
          <li className="hours-row">
            <span className="hours-state t-label">{transfer.closed}</span>
            <span className="t-data hours-time">{transfer.closedTime}</span>
            <span className="hours-result t-small">{transfer.closedResult}</span>
          </li>
        </ul>
        <p className="tile-foot t-small t-muted">{transfer.note}</p>
      </article>

      <article className="tile tile-languages">
        <h3 className="t-h3">{languages.title}</h3>
        <ul className="lang-chips">
          {voices.map((v) => (
            <li key={v.id} lang={v.lang}>
              {v.chip}
            </li>
          ))}
        </ul>
        <p className="tile-foot t-small t-muted">{languages.body}</p>
      </article>
    </div>
  );
}
