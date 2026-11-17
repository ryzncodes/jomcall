"use client";
import type { MouseEvent, ReactNode } from "react";
import { useCore, useWords, useResource } from "../state";
import { useExperience } from "../../experience";
import { useAgentPage } from "./store";
import { statusOf, weekSummary, type View } from "./rules";

// The agent page's home: what the agent is doing now, four rows into the
// parts an owner changes, and Try it / Publish changes at the bottom.
export function Home() {
  const w = useWords(),
    { href, locale } = useExperience(),
    { client, workspace } = useCore(),
    page = useAgentPage(),
    { agentId, settings, reloadKey } = page,
    publishedId = workspace.agent.published_version_id,
    key = agentId + "|" + reloadKey;
  const gaps = useResource(
      () => client.execute("knowledgeGaps", { id: agentId, status: "open" }),
      key,
    ),
    core = useResource(
      () => client.execute("knowledgeCore", { id: agentId }),
      key,
    ),
    hours = useResource(async () => {
      const locations = await client.execute("locations", {});
      const main = locations.find((l) => l.primary_location) ?? locations[0];
      let weekdays = null;
      if (main) {
        try {
          const s = await client.execute("schedule", { id: main.id });
          // Revision 0 is the empty week the server returns when none was saved.
          weekdays = s.revision === 0 ? null : s.weekdays;
        } catch {
          weekdays = null;
        }
      }
      return { branches: locations.length, week: weekSummary(weekdays) };
    }, key),
    channels = useResource(() => client.execute("channels", {}), key),
    version = useResource(
      () =>
        publishedId
          ? client.execute("version", { agentId, id: publishedId })
          : Promise.resolve(null),
      agentId + "|" + (publishedId ?? ""),
    );
  const status = statusOf(publishedId, page.changes?.count ?? 0);
  const loading = w("Loading…", "Memuatkan…"),
    failed = w("Could not load this", "Tidak dapat memuatkan ini");
  const open = (view: View) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    void page.go(view);
  };
  const row = (view: View, title: string, sub: ReactNode, count?: number) => (
    <a className="agent-row" href={"#" + view} onClick={open(view)}>
      <span className="agent-row-text">
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      {count ? (
        <span
          className="agent-count"
          aria-label={w(count + " waiting", count + " menunggu")}
        >
          {count}
        </span>
      ) : null}
      <span className="agent-chev" aria-hidden="true">
        ›
      </span>
    </a>
  );

  const name =
    version.data?.snapshot.settings.name || settings.name || w("Your agent", "Ejen anda");
  const when = version.data
    ? new Date(version.data.created_at).toLocaleDateString(
        locale === "ms" ? "ms-MY" : "en-MY",
        { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" },
      )
    : "";
  const ch = channels.data;
  const channelLine = !ch
    ? ""
    : ch.phone && ch.whatsapp
      ? w("Answers on phone and WhatsApp", "Menjawab di telefon dan WhatsApp")
      : ch.phone
        ? w("Answers on the phone", "Menjawab di telefon")
        : ch.whatsapp
          ? w("Answers on WhatsApp", "Menjawab di WhatsApp")
          : w(
              "Answers test calls only",
              "Menjawab panggilan ujian sahaja",
            );

  const langName = {
    ms: "BM",
    en: w("English", "Inggeris"),
    zh: w("Mandarin", "Mandarin"),
  };
  const languages = settings.languages
    .map((l) => langName[l])
    .join(w(" and ", " dan "));
  const nothing = !!publishedId && page.changes?.count === 0;
  const n = page.changes?.count ?? 0;

  return (
    <>
      <section className="agent-card" aria-labelledby="agent-status">
        {status.state === "unpublished" ? (
          <>
            <h2 id="agent-status">{w("Not published yet", "Belum diterbitkan")}</h2>
            <p>{channelLine || loading}</p>
            <a className="agent-link" href={href("/app/setup")}>
              {w(
                "Set up your agent step by step",
                "Sediakan ejen anda langkah demi langkah",
              )}
            </a>
          </>
        ) : (
          <>
            <div className="agent-card-top">
              <h2 id="agent-status">
                {w(name + " is answering", name + " sedang menjawab")}
              </h2>
              <span className="agent-pill agent-pill-live">
                {w("Live", "Aktif")}
              </span>
            </div>
            <p>
              {[channelLine, when && w("published " + when, "diterbitkan " + when)]
                .filter(Boolean)
                .join(" · ") || loading}
            </p>
            {status.state === "pending" && (
              <span className="agent-pill agent-pill-warn">
                {w(
                  n === 1 ? "1 change not live yet" : n + " changes not live yet",
                  n + " perubahan belum aktif",
                )}
              </span>
            )}
          </>
        )}
      </section>

      <nav className="agent-rows" aria-label={w("Agent sections", "Bahagian ejen")}>
        {row(
          "questions",
          w("Questions it could not answer", "Soalan yang tidak dapat dijawab"),
          gaps.error
            ? failed
            : w(
                "Customers asked these and it had no answer",
                "Pelanggan bertanya ini dan ejen tiada jawapan",
              ),
          gaps.data?.length,
        )}
        {row(
          "knowledge",
          w("What it knows", "Apa yang ejen tahu"),
          core.error
            ? failed
            : core.data
              ? w(
                  `${core.data.facts.filter((f) => f.status === "confirmed").length} facts · ${core.data.catalogue.total} prices · ${core.data.rules.filter((r) => r.status === "confirmed" && r.enabled).length} rules`,
                  `${core.data.facts.filter((f) => f.status === "confirmed").length} fakta · ${core.data.catalogue.total} harga · ${core.data.rules.filter((r) => r.status === "confirmed" && r.enabled).length} peraturan`,
                )
              : loading,
        )}
        {row(
          "hours",
          w("Opening hours", "Waktu operasi"),
          hours.error
            ? failed
            : hours.data
              ? `${w(hours.data.week.en, hours.data.week.ms)} · ${w(
                  hours.data.branches === 1
                    ? "1 branch"
                    : hours.data.branches + " branches",
                  hours.data.branches + " cawangan",
                )}`
              : loading,
        )}
        {row(
          "greeting",
          w("Greeting and voice", "Salam dan suara"),
          `${
            settings.aiDisclosure.trim()
              ? w("Says it is an AI", "Memberitahu ia AI")
              : w("No AI introduction yet", "Belum ada pengenalan AI")
          } · ${languages}`,
        )}
      </nav>

      <a className="agent-more" href="#more" onClick={open("more")}>
        {w(
          "More: call types, written instructions, past versions",
          "Lagi: jenis panggilan, arahan bertulis, versi lalu",
        )}
      </a>

      <div className="agent-bar">
        <a className="button button-small agent-try" href={href("/app/test")}>
          {w("Try it", "Cuba")}
        </a>
        <button
          type="button"
          className="button button-small button-dark"
          disabled={nothing}
          onClick={() => void page.go("publish")}
        >
          {nothing
            ? w("Nothing to publish", "Tiada apa untuk diterbitkan")
            : w("Publish changes", "Terbitkan perubahan")}
        </button>
      </div>
    </>
  );
}
