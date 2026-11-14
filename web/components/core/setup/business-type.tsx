"use client";
// Stage 1: one tap for the business type, optional extra call types it pairs
// with, then Continue. Starting (or changing) the session freezes the
// interview on the server.
import { useState } from "react";
import { businessTypes } from "../../../../packages/domain/src/setup/business-types";
import type { Setup } from "../../../../packages/contracts/src/setup";
import { useCore, useWords, Notice } from "../state";
import { HOSTED } from "@/lib/hosted";
import { BASE_PACK, useLanding, type PackInfo } from "./flow";

const MAX_EXTRAS = 3;

export function BusinessTypeStage({
  packs,
  session,
  onStarted,
  onCancel,
}: {
  packs: PackInfo[];
  session: Setup["session"];
  onStarted: (view: Setup) => void;
  onCancel?: () => void;
}) {
  const { client, workspace } = useCore(),
    w = useWords();
  // Preselect: the open session's pack, else the type whose English label
  // the workspace was created with; otherwise nothing.
  const [typeId, setTypeId] = useState(() => {
    const saved = workspace.workspace.business_type;
    if (session)
      return (
        businessTypes.find(
          (t) => t.pack === session.mainPack && t.en === saved,
        ) ?? businessTypes.find((t) => t.pack === session.mainPack)
      )?.id;
    return businessTypes.find((t) => t.en === saved)?.id;
  });
  const [extras, setExtras] = useState<string[]>(session?.extraPacks ?? []);
  const [busy, setBusy] = useState(false);
  const heading = useLanding<HTMLHeadingElement>("type");
  const [error, setError] = useState<unknown>();
  const type = businessTypes.find((t) => t.id === typeId);
  const main = packs.find((p) => p.id === type?.pack);
  const pairs = (main?.pairsWith ?? [])
    .map((id) => packs.find((p) => p.id === id))
    .filter((p): p is PackInfo => !!p && p.id !== BASE_PACK);

  return (
    <div className="setup-flow">
      <header className="setup-head">
        <p className="eyebrow">
          {w(
            HOSTED ? "Guided setup" : "Guided setup · local workspace",
            HOSTED
              ? "Persediaan berpandu"
              : "Persediaan berpandu · ruang kerja setempat",
          )}
        </p>
        <h1 className="setup-title" ref={heading} tabIndex={-1}>
          {w("What kind of business is this?", "Apakah jenis perniagaan ini?")}
        </h1>
        <p className="setup-lead">
          {w(
            "Pick the closest match. Up to 8 short questions follow, then one page to check.",
            "Pilih yang paling hampir. Selepas ini ada hingga 8 soalan ringkas, kemudian satu halaman untuk disemak.",
          )}
        </p>
      </header>
      <form
        className="setup-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!type) return;
          setBusy(true);
          setError(undefined);
          try {
            const view = await client.execute("startSetup", {
              id: workspace.agent.id,
              mainPack: type.pack,
              extraPacks: extras.filter((x) => pairs.some((p) => p.id === x)),
            });
            onStarted(view);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="setup-options">
          <legend className="setup-legend">
            {w("Business type", "Jenis perniagaan")}
          </legend>
          {businessTypes.map((t) => (
            <label key={t.id} className="setup-option">
              <input
                type="radio"
                name="setup-business-type"
                value={t.id}
                checked={typeId === t.id}
                onChange={() => {
                  setTypeId(t.id);
                  const next = packs.find((p) => p.id === t.pack);
                  setExtras((x) =>
                    x.filter((id) => next?.pairsWith.includes(id)),
                  );
                }}
              />
              <span>{w(t.en, t.ms)}</span>
            </label>
          ))}
        </fieldset>
        {pairs.length > 0 && (
          <fieldset className="setup-options">
            <legend className="setup-legend">
              {w(
                "Do callers also ask about these?",
                "Adakah pemanggil juga bertanya tentang perkara ini?",
              )}
            </legend>
            <p className="setup-hint">
              {w(
                "Optional. Tick any that apply, up to 3.",
                "Pilihan. Tandakan yang berkaitan, maksimum 3.",
              )}
            </p>
            {pairs.map((p) => {
              const on = extras.includes(p.id);
              return (
                <label key={p.id} className="setup-option setup-tick">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && extras.length >= MAX_EXTRAS}
                    onChange={() =>
                      setExtras((x) =>
                        on ? x.filter((id) => id !== p.id) : [...x, p.id],
                      )
                    }
                  />
                  <span>
                    {w(p.name.en, p.name.ms)}
                    <small>{w(p.callPurpose.en, p.callPurpose.ms)}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <Notice error={error} />
        <div className="setup-nav">
          {onCancel && (
            <button
              type="button"
              className="button secondary-button"
              onClick={onCancel}
            >
              {w("Back", "Kembali")}
            </button>
          )}
          <button className="button button-dark" disabled={!type || busy}>
            {busy ? w("Starting…", "Memulakan…") : w("Continue", "Teruskan")}
          </button>
        </div>
      </form>
    </div>
  );
}
