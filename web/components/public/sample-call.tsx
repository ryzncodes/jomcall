import { common } from "@/content/public/common";
import type { SampleLine } from "@/content/public/types";
import type { PublicLocale } from "@/lib/site";

// A made-up call, shown as a quiet static transcript: the same turns and
// event marks as the home call card, without its motion or sound. Every
// sample is labelled as made up.
export function SampleCall({
  locale,
  business,
  lines,
  outcome,
}: {
  locale: PublicLocale;
  business: string;
  lines: SampleLine[];
  outcome?: string;
}) {
  const t = common[locale].article;
  return (
    <figure className="sample" aria-label={`${business}. ${t.sample}`}>
      <figcaption className="sample-top">
        <span className="t-data sample-biz">{business}</span>
        <span className="sample-label">{t.sample}</span>
      </figcaption>
      <ol className="sample-lines">
        {lines.map((line, i) =>
          line.who === "event" ? (
            <li key={i} className="sample-event">
              <span className="sample-tick" aria-hidden="true" />
              {line.text}
            </li>
          ) : (
            <li key={i} className={`sample-turn sample-${line.who}`}>
              <span className="sample-who">{line.who === "caller" ? t.caller : t.agent}</span>
              <p lang={line.lang && line.lang !== locale ? line.lang : undefined}>{line.text}</p>
            </li>
          ),
        )}
      </ol>
      {outcome && <p className="sample-outcome t-small">{outcome}</p>}
    </figure>
  );
}
