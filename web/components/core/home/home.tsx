"use client";
// Home: a checklist until the agent is live, then today's numbers and what
// needs the owner. Each read can fail alone; see load.ts.
import { CaretRight, CheckCircle, Circle, Clock } from "@phosphor-icons/react";
import {
  checklist,
  homeState,
  keepLastGood,
  needsYou,
  todayCounts,
  type HomeFacts,
  type StepId,
} from "@/lib/core/home-rules";
import { useRef } from "react";
import { useExperience } from "../../experience";
import { Heading, Loading, useCore, useResource, useWords } from "../state";
import { loadHomeFacts } from "./load";
import { needText, todayParts, type W } from "./copy";

const STEPS: Record<StepId, { label: [string, string]; button: [string, string] }> = {
  setup: { label: ["Set up your business", "Sediakan perniagaan anda"], button: ["Setup", "Persediaan"] },
  test: { label: ["Test the agent", "Uji ejen"], button: ["Try it", "Cuba"] },
  publish: { label: ["Publish the agent", "Terbitkan ejen"], button: ["Publish", "Terbitkan"] },
  plan: { label: ["Choose a plan", "Pilih pelan"], button: ["Choose plan", "Pilih pelan"] },
  phone: { label: ["Get a phone number", "Dapatkan nombor telefon"], button: ["Request number", "Minta nombor"] },
};

export function LocalHome() {
  const { client, workspace, refresh } = useCore(),
    w = useWords(),
    { href } = useExperience();
  const manager = workspace.role !== "staff";
  const published = !!workspace.agent?.published_version_id;
  const agentId = workspace.agent?.id ?? null;
  const last = useRef<{ key: string; facts: HomeFacts } | undefined>(undefined);
  const key = `home|${workspace.workspace.id}|${manager}|${published}|${agentId}`;
  const facts = useResource(async () => {
    const next = await loadHomeFacts(
      client as unknown as Parameters<typeof loadHomeFacts>[0],
      { manager, published, agentId },
      new Date(),
    );
    const merged = keepLastGood(last.current?.key === key ? last.current.facts : undefined, next);
    last.current = { key, facts: merged };
    return merged;
  }, key).data;
  const state = facts && homeState(facts);
  const steps = facts ? checklist(facts) : [];
  const done = steps.filter((s) => s.state === "done").length;
  // Neutral until the facts arrive, so a live workspace never flashes the
  // checklist title.
  const title =
    state === "today"
      ? w("Today", "Hari ini")
      : state === "checklist"
        ? w("Get your agent answering", "Sediakan ejen anda untuk menjawab")
        : w("Home", "Utama");
  const description =
    state === "checklist"
      ? w(`${done} of ${steps.length} done`, `${done} daripada ${steps.length} selesai`)
      : state === "today"
        ? w("What needs you now.", "Perkara yang perlu anda uruskan.")
        : " ";
  return (
    <>
      <Heading eyebrow={workspace.workspace.name} title={title} description={description} />
      {!facts && <Loading />}
      {state === "failed" && (
        <section className="core-panel home-failed" role="alert">
          <p>{w("Home could not load.", "Laman utama tidak dapat dimuatkan.")}</p>
          <button type="button" className="button secondary-button" onClick={refresh}>
            {w("Retry", "Cuba lagi")}
          </button>
        </section>
      )}
      {state === "checklist" && (
        <ol className="home-steps">
          {steps.map((s) => {
            const t = STEPS[s.id];
            const Icon = s.state === "done" ? CheckCircle : s.state === "waiting" ? Clock : Circle;
            return (
              <li key={s.id} data-state={s.state}>
                <Icon className="home-step-icon" size={22} weight={s.state === "done" ? "fill" : "regular"} aria-hidden />
                <span className="home-step-label">
                  {w(...t.label)}
                  {s.state === "waiting" && (
                    <small>{w("Waiting for your number", "Menunggu nombor anda")}</small>
                  )}
                  {s.state === "todo" && !manager && (
                    <small>{w("An owner or admin does this step.", "Pemilik atau pentadbir melakukan langkah ini.")}</small>
                  )}
                  <span className="sr-only">
                    {s.state === "done"
                      ? w(" (done)", " (selesai)")
                      : s.state === "waiting"
                        ? ""
                        : w(" (not done)", " (belum selesai)")}
                  </span>
                </span>
                {s.state === "todo" && s.href && (
                  <a className="button secondary-button" href={href(s.href)}>
                    {s.unpaid ? w("Pay fee", "Bayar yuran") : w(...t.button)}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {state === "today" && facts && <Today facts={facts} w={w} href={href} />}
    </>
  );
}

function Today({
  facts,
  w,
  href,
}: {
  facts: HomeFacts;
  w: W;
  href: (p: string) => string;
}) {
  const c = todayCounts(facts, new Date());
  const needs = needsYou(facts);
  const parts = todayParts(c, w);
  return (
    <>
      {parts.length > 0 && (
        <p className="home-today">
          {parts.map((p, i) => (
            <span key={i}>
              {p.label && <span className="home-today-label">{p.label} </span>}
              {p.text}
              {i < parts.length - 1 && <span className="sr-only">, </span>}
            </span>
          ))}
        </p>
      )}
      <section className="core-panel home-needs">
        <h2>{w("Needs you", "Perlu tindakan anda")}</h2>
        {needs.length ? (
          <ul>
            {needs.map((n) => (
              <li key={n.id} data-kind={n.id.startsWith("wallet") || n.id === "plan_unpaid" ? "billing" : undefined}>
                <a href={href(n.href)}>
                  <span>{needText(n, w, c.balanceSen)}</span>
                  <CaretRight size={18} aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>{w("All clear", "Semua beres")}</p>
        )}
      </section>
    </>
  );
}
