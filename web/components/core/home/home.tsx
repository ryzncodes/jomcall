"use client";
// Home: a checklist until the agent is live, then today's numbers and what
// needs the owner. Each read can fail alone; see load.ts.
import { CaretRight } from "@phosphor-icons/react";
import {
  checklist,
  checklistFacts,
  homeState,
  keepLastGood,
  needsYou,
  todayCounts,
  type HomeFacts,
} from "@/lib/core/home-rules";
import { useEffect, useRef, useState } from "react";
import { useExperience } from "../../experience";
import { Heading, Loading, useCore, useResource, useWords } from "../state";
import { loadHomeFacts } from "./load";
import { needText, todayParts, type W } from "./copy";
import { ChecklistSteps } from "./steps";

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
      {state === "checklist" && facts && (
        <>
          <ChecklistSteps
            steps={steps}
            manager={manager}
            activeE164={checklistFacts(facts).phone?.activeE164 ?? null}
          />
          {/* Billing problems and waiting customers are never hidden
              behind the list; the panel shows only when it has rows. */}
          <NeedsPanel facts={facts} w={w} href={href} hideEmpty />
        </>
      )}
      {state === "today" && facts && (
        <>
          <FirstCallLine facts={facts} orgId={workspace.workspace.id} w={w} href={href} />
          <Today facts={facts} w={w} href={href} />
        </>
      )}
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
      <NeedsPanel facts={facts} w={w} href={href} />
    </>
  );
}

function NeedsPanel({
  facts,
  w,
  href,
  hideEmpty,
}: {
  facts: HomeFacts;
  w: W;
  href: (p: string) => string;
  hideEmpty?: boolean;
}) {
  const needs = needsYou(facts);
  const c = todayCounts(facts, new Date());
  if (hideEmpty && !needs.length) return null;
  return (
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
  );
}

// Shown once per browser, on the first Today after the first real call.
function FirstCallLine({
  facts,
  orgId,
  w,
  href,
}: {
  facts: HomeFacts;
  orgId: string;
  w: W;
  href: (p: string) => string;
}) {
  const call = facts.firstRun?.firstCall;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!call) return;
    const key = `jomcall.firstCallSeen.${orgId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, call.id);
    } catch {
      return;
    }
    setShow(true);
  }, [call, orgId]);
  if (!call || !show) return null;
  return (
    <p className="core-panel home-first-call" role="status">
      <a href={href(`/app/calls/${call.id}`)}>
        {w("Your agent answered its first real call.", "Ejen anda telah menjawab panggilan sebenar pertamanya.")}
      </a>
    </p>
  );
}
