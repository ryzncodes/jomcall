"use client";
// "Your links" on the review page (first-run design 5.2a): the business's
// own pages, staged into the social_links fact through the review page's
// "missing:" answer path. The links are checked as text; nothing opens them.
import { useId, useState, type ReactNode } from "react";
import type { SetupItem } from "../../../../packages/contracts/src/setup";
import {
  LINK_KINDS,
  LINK_LABELS,
  linksToText,
  normaliseLink,
  textToLinks,
  type LinkKind,
  type Links,
} from "@/lib/core/business-links";
import { useCore, useWords } from "../state";
import { useAutosave, useSetup } from "./flow";
import { factFlagged } from "./rules";

export const LINKS_QUESTION = "missing:every-business:social_links";

const LABEL_MS: Partial<Record<LinkKind, string>> = { website: "Laman web" };

// choice: the review page's keep-or-use-new choice, drawn when the agent
// already has links. onConfirm: confirms links read from a document that the
// reader was unsure of; apply leaves them out until then.
export function LinksCard({
  item,
  choice,
  onConfirm,
}: {
  item: SetupItem | undefined;
  choice: (next: string) => ReactNode;
  onConfirm: () => Promise<boolean>;
}) {
  const { client } = useCore(),
    w = useWords(),
    store = useSetup();
  const id = useId();
  const stored =
    item && item.state !== "removed"
      ? textToLinks(String((item.payload as { value?: unknown })?.value ?? ""))
      : {};
  const [values, setValues] = useState<Links>(stored);
  const [open, setOpen] = useState(false);
  const auto = useAutosave((text: string) =>
    store.write((expectedRevision) =>
      client.execute("answerSetup", {
        id: store.agentId,
        questionId: LINKS_QUESTION,
        expectedRevision,
        answer: text ? { kind: "fact", text } : { kind: "skip" },
      }),
    ),
  );
  const [confirming, setConfirming] = useState(false);
  const checked = LINK_KINDS.map((k) => [k, normaliseLink(k, values[k] ?? "")] as const);
  const send = (next: Links) => {
    const good: Links = stored.extra ? { extra: stored.extra } : {};
    for (const k of LINK_KINDS) {
      const r = normaliseLink(k, next[k] ?? "");
      if (r && "url" in r) good[k] = r.url;
      // A field that is not a link yet keeps what was saved for it, so a
      // half-typed address never replaces a good one and the other fields
      // still save.
      else if (r && stored[k]) good[k] = stored[k];
    }
    auto.change(linksToText(good));
  };
  const flagged = !!item && factFlagged(item);
  const text = item && item.state !== "removed" ? linksToText(stored) : "";
  const saved = LINK_KINDS.filter((k) => stored[k]);
  const label = (k: LinkKind) => w(LINK_LABELS[k], LABEL_MS[k] ?? LINK_LABELS[k]);
  return (
    <section className="setup-card" aria-labelledby={`${id}-title`}>
      <div className="setup-card-row">
        <div>
          <h2 id={`${id}-title`} className="setup-card-label">
            {w("Your links", "Pautan anda")}
          </h2>
          <p className="setup-card-value">
            {saved.length
              ? saved.map(label).join(", ")
              : w("Optional. Website, Facebook, Google Maps and others.", "Pilihan. Laman web, Facebook, Google Maps dan lain-lain.")}
          </p>
        </div>
        <button
          type="button"
          className="setup-link"
          aria-expanded={open}
          aria-controls={`${id}-fields`}
          onClick={async () => {
            if (open) await auto.flush();
            setOpen(!open);
          }}
        >
          {open ? w("Done", "Siap") : saved.length ? w("Edit", "Sunting") : w("Add", "Tambah")}
        </button>
      </div>
      {stored.extra && (
        <p className="setup-hint">
          {w("Also kept with your links:", "Turut disimpan bersama pautan anda:")} {stored.extra}
        </p>
      )}
      {flagged && text && (
        <div className="setup-check">
          <p className="setup-check-title">{w("Please check", "Sila semak")}</p>
          <p className="setup-hint">
            {w(
              "Read from your document. These links are left out until you confirm them.",
              "Dibaca daripada dokumen anda. Pautan ini tidak dimasukkan sehingga anda mengesahkannya.",
            )}
          </p>
          <button
            type="button"
            className="button secondary-button"
            aria-disabled={confirming || undefined}
            onClick={async () => {
              if (confirming) return;
              setConfirming(true);
              try {
                await auto.flush();
                await onConfirm();
              } finally {
                setConfirming(false);
              }
            }}
          >
            {w("Confirm links", "Sahkan pautan")}
          </button>
        </div>
      )}
      {text && choice(text)}
      {open && (
        <div id={`${id}-fields`} className="setup-links-fields">
          <p className="setup-hint">
            {w(
              "Customers who ask get these links. JomCall does not open or read them.",
              "Pelanggan yang bertanya akan diberi pautan ini. JomCall tidak membuka atau membaca pautan ini.",
            )}
          </p>
          {checked.map(([k, r]) => {
            const fid = `${id}-${k}`;
            const problem =
              r && "error" in r
                ? r.error === "too_long"
                  ? w("This link is too long.", "Pautan ini terlalu panjang.")
                  : w("This is not a web link.", "Ini bukan pautan web.")
                : r && r.warning
                  ? w(`This does not look like a ${LINK_LABELS[k]} link.`, `Ini tidak kelihatan seperti pautan ${LINK_LABELS[k]}.`)
                  : null;
            return (
              <div className="product-field" key={k}>
                <label htmlFor={fid}>{label(k)}</label>
                <input
                  id={fid}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={300}
                  value={values[k] ?? ""}
                  aria-invalid={(r && "error" in r) || undefined}
                  aria-describedby={problem ? `${fid}-note` : undefined}
                  onChange={(e) => {
                    const next = { ...values, [k]: e.target.value };
                    setValues(next);
                    send(next);
                  }}
                  onBlur={() => void auto.flush()}
                />
                {problem && <small id={`${fid}-note`}>{problem}</small>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
