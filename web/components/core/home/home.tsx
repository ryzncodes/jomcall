"use client";
// Home: a checklist until the agent is live, then today's numbers and what
// needs the owner. Each read can fail alone; see load.ts.
import { CaretRight, CheckCircle, Circle, Clock } from "@phosphor-icons/react";
import { formatSen } from "../../../../packages/billing/src/money";
import {
  checklist,
  homeState,
  needsYou,
  todayCounts,
  type Need,
  type StepId,
} from "@/lib/core/home-rules";
import { dayText } from "@/lib/core/plan-rules";
import { useExperience } from "../../experience";
import { Heading, useCore, useResource, useWords } from "../state";
import { loadHomeFacts } from "./load";

type W = (en: string, ms: string) => string;

const STEPS: Record<StepId, { label: [string, string]; button: [string, string] }> = {
  setup: { label: ["Set up your business", "Sediakan perniagaan anda"], button: ["Setup", "Persediaan"] },
  test: { label: ["Test the agent", "Uji ejen"], button: ["Try it", "Cuba"] },
  publish: { label: ["Publish the agent", "Terbitkan ejen"], button: ["Publish", "Terbitkan"] },
  plan: { label: ["Choose a plan", "Pilih pelan"], button: ["Choose plan", "Pilih pelan"] },
  phone: { label: ["Get a phone number", "Dapatkan nombor telefon"], button: ["Request number", "Minta nombor"] },
};

function needText(n: Need, w: W, ms: boolean, balanceSen: number | null) {
  const rm = balanceSen === null ? "" : formatSen(balanceSen);
  switch (n.id) {
    case "wallet_exhausted":
      return w("Wallet empty: calls are not answered", "Dompet kosong: panggilan tidak dijawab");
    case "wallet_grace":
      return w("Wallet below zero: top up soon", "Baki dompet di bawah sifar: tambah nilai segera");
    case "plan_unpaid":
      return n.date
        ? w(`Plan fee unpaid: pay by ${dayText(n.date, false)}`, `Yuran pelan belum dibayar: bayar sebelum ${dayText(n.date, true)}`)
        : w("Plan fee unpaid", "Yuran pelan belum dibayar");
    case "wallet_low":
      return w(`Wallet low: ${rm}`, `Baki dompet rendah: ${rm}`);
    case "bookings":
      return w(`${n.count} bookings to confirm`, `${n.count} tempahan perlu disahkan`);
    case "chats":
      return w(`${n.count} WhatsApp chats waiting for you`, `${n.count} sembang WhatsApp menunggu anda`);
    case "gaps":
      return w(`${n.count} questions the agent could not answer`, `${n.count} soalan yang ejen tidak dapat jawab`);
  }
}

export function LocalHome() {
  const { client, workspace, refresh } = useCore(),
    w = useWords(),
    { href, locale } = useExperience(),
    ms = locale === "ms";
  const manager = workspace.role !== "staff";
  const published = !!workspace.agent?.published_version_id;
  const agentId = workspace.agent?.id ?? null;
  const facts = useResource(
    () =>
      loadHomeFacts(
        client as unknown as Parameters<typeof loadHomeFacts>[0],
        { manager, published, agentId },
        new Date(),
      ),
    `home|${workspace.workspace.id}|${manager}|${published}|${agentId}`,
  ).data;
  const state = facts && homeState(facts);
  const steps = facts ? checklist(facts) : [];
  const done = steps.filter((s) => s.state === "done").length;
  const title =
    state === "today"
      ? w("Today", "Hari ini")
      : w("Get your agent answering", "Sediakan ejen anda untuk menjawab");
  const description =
    state === "checklist"
      ? w(`${done} of ${steps.length} done`, `${done} daripada ${steps.length} selesai`)
      : state === "today"
        ? w("What needs you now.", "Perkara yang perlu anda uruskan.")
        : " ";
  return (
    <>
      <Heading eyebrow={workspace.workspace.name} title={title} description={description} />
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
                  <span className="sr-only">
                    {s.state === "done" ? w(" (done)", " (selesai)") : ""}
                  </span>
                </span>
                {s.state === "todo" && s.href && (
                  <a className="button secondary-button" href={href(s.href)}>
                    {w(...t.button)}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {state === "today" && facts && <Today facts={facts} w={w} ms={ms} href={href} />}
    </>
  );
}

function Today({
  facts,
  w,
  ms,
  href,
}: {
  facts: NonNullable<Parameters<typeof needsYou>[0]>;
  w: W;
  ms: boolean;
  href: (p: string) => string;
}) {
  const c = todayCounts(facts, new Date());
  const needs = needsYou(facts);
  const parts = [
    c.calls !== null && w(`${c.calls} calls`, `${c.calls} panggilan`),
    c.missed !== null && w(`${c.missed} not answered`, `${c.missed} tidak dijawab`),
    c.bookings !== null && w(`${c.bookings} bookings`, `${c.bookings} tempahan`),
    c.balanceSen !== null && formatSen(c.balanceSen),
  ].filter(Boolean) as string[];
  return (
    <>
      {parts.length > 0 && (
        <p className="home-today">
          {parts.map((p, i) => (
            <span key={i}>{p}</span>
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
                  <span>{needText(n, w, ms, c.balanceSen)}</span>
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
