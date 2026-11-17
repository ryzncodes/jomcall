"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { AgentChanges } from "../../../../packages/contracts/src/core";
import { useExperience } from "../../experience";
import { errorText, useCore, useResource, useWords } from "../state";
import {
  KIND_HEADING,
  SETTING_FIELDS,
  changeLine,
  groupChanges,
  groupTotal,
  isChangesMoved,
  missingDisclosure,
  publishBlock,
  trySuggestion,
  type View,
} from "./rules";
import { useAgentPage } from "./store";

// The publish sheet: what will change, the disclosures that gate Publish,
// and one button that sends the change token the list was drawn from.
export function Publish() {
  const w = useWords(),
    { locale, href } = useExperience(),
    { client, refresh } = useCore(),
    page = useAgentPage(),
    { agentId, settings, reloadKey } = page;
  const [read, setRead] = useState<AgentChanges>();
  const [readError, setReadError] = useState<unknown>();
  const [reading, setReading] = useState(true);
  const [moved, setMoved] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const seq = useRef(0),
    alive = useRef(true),
    lock = useRef(false),
    wasUnsaved = useRef(false),
    loaded = useRef(false);
  const ms = locale === "ms";
  const words = (x: { en: string; ms: string }) => w(x.en, x.ms);
  const unsaved = page.dirty || page.hours.unsaved();

  // Waits for the queue and the schedule saves, then reads the list. A reply
  // for an older read is dropped.
  const load = async () => {
    const mine = ++seq.current;
    setReading(true);
    setReadError(undefined);
    page.flush();
    await Promise.all([page.queue.idle(), page.hours.settled()]);
    if (!alive.current || mine !== seq.current) return;
    try {
      const c = await client.execute("agentChanges", { id: agentId });
      if (!alive.current || mine !== seq.current) return;
      setRead(c);
      loaded.current = true;
    } catch (e) {
      if (!alive.current || mine !== seq.current) return;
      setRead(undefined);
      setReadError(e);
    } finally {
      if (alive.current && mine === seq.current) setReading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current++;
    };
  }, []);
  // On open, and again after a conflict reset the page.
  useEffect(() => {
    setMoved(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  // Edits that were unsaved and now landed make the list stale: read again.
  useEffect(() => {
    if (wasUnsaved.current && !unsaved && loaded.current) void load();
    wasUnsaved.current = unsaved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsaved]);

  const go = (view: View) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    void page.go(view);
  };

  const publish = async () => {
    if (!read || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setMoved(false);
    const token = read.token;
    let refused = false;
    try {
      page.flush();
      await page.queue.push({
        run: async (expectedRevision, key) => {
          try {
            await client.execute(
              "publish",
              { id: agentId, expectedRevision, changeToken: token },
              key,
            );
          } catch (e) {
            // The list moved under the sheet. Nothing was published and the
            // agent revision did not move, so this is not a conflict.
            if (isChangesMoved(e)) {
              refused = true;
              return expectedRevision;
            }
            throw e;
          }
          // Publishing can move the agent revision; read where it stands.
          let next = expectedRevision + 1;
          try {
            next = (await client.execute("draft", { id: agentId })).revision;
          } catch {
            /* the plus-one above is what the server did */
          }
          return next;
        },
      });
      if (refused) {
        setMoved(true);
        await load();
        return;
      }
      page.refreshChanges();
      refresh();
      await page.go("home");
      page.announce(
        w(
          "Published. Your agent now uses these changes.",
          "Diterbitkan. Ejen anda kini menggunakan perubahan ini.",
        ),
      );
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const block = read
    ? publishBlock({
        settingsUnsaved: page.dirty,
        hoursUnsaved: page.hours.unsaved(),
        published: read.published,
        count: read.count,
      })
    : null;
  const missing = missingDisclosure(settings);
  // Pack ids come with the changes; the names are the call types' own.
  const packList = useResource(() => client.execute("packs", {}), "packs");
  const packName = (id: string) => {
    const p = packList.data?.find((x) => x.id === id);
    return p ? w(p.name.en, p.name.ms) : undefined;
  };
  const suggestion = read ? trySuggestion(read.changes) : null;
  const groups = read ? groupChanges(read.changes) : [];

  const status = reading
    ? w("Reading your changes…", "Membaca perubahan anda…")
    : moved
      ? w(
          "Something changed since you opened this. Check the list again.",
          "Ada perubahan sejak anda membuka ini. Semak senarai sekali lagi.",
        )
      : "";
  const problem = error ?? readError;

  return (
    <section className="agent-view" aria-labelledby="agent-publish-h">
      <h2 id="agent-publish-h">{w("Publish", "Terbitkan")}</h2>
      <p className="agent-publish-status" role="status" aria-live="polite">
        {status}
      </p>
      <div role="alert">
        {problem ? (
          <p className="agent-field-error">{errorText(problem, ms)}</p>
        ) : null}
      </div>
      {readError ? (
        <button
          type="button"
          className="button button-small"
          onClick={() => void load()}
        >
          {w("Try again", "Cuba lagi")}
        </button>
      ) : null}

      {read && block === "unsaved" && (
        <div className="agent-publish-block">
          <p>
            {w(
              "Some of what you typed is not saved yet. Publishing now would leave it out.",
              "Sebahagian yang anda taip belum disimpan. Jika diterbitkan sekarang, ia tertinggal.",
            )}
          </p>
          <p>
            {page.dirty && (
              <a
                className="agent-link"
                href="#greeting"
                onClick={go("greeting")}
              >
                {w("Go to your settings", "Pergi ke tetapan anda")}
              </a>
            )}{" "}
            {page.hours.unsaved() && (
              <a className="agent-link" href="#hours" onClick={go("hours")}>
                {w("Go to opening hours", "Pergi ke waktu operasi")}
              </a>
            )}
          </p>
        </div>
      )}

      {read && block === "nothing" && (
        <div className="agent-publish-block">
          <p>
            {w(
              "Nothing to publish. Your agent already answers with everything you have set.",
              "Tiada apa untuk diterbitkan. Ejen anda sudah menjawab dengan semua yang anda tetapkan.",
            )}
          </p>
          <a className="agent-link" href="#" onClick={go("home")}>
            {w("Back to your agent", "Kembali ke ejen anda")}
          </a>
        </div>
      )}

      {read && block === null && (
        <>
          <p className="agent-publish-count">
            {read.published
              ? w(
                  read.count === 1
                    ? "1 change will go live"
                    : `${read.count} changes will go live`,
                  `${read.count} perubahan akan aktif`,
                )
              : w(
                  "This is the first time your agent goes live. Everything below is new.",
                  "Ini kali pertama ejen anda aktif. Semua di bawah adalah baharu.",
                )}
          </p>
          {groups.map((g) => {
            const showAll = open.includes(g.kind);
            const collapsed = g.collapsed && !showAll;
            const total = groupTotal(g.lines);
            const id = "agent-publish-" + g.kind;
            const allAdded = g.lines.every((l) => l.op === "added");
            return (
              <section
                key={g.kind}
                className="agent-group"
                aria-labelledby={id}
              >
                <h3 id={id}>{words(KIND_HEADING[g.kind])}</h3>
                {collapsed ? (
                  <p className="agent-group-sum">
                    {allAdded
                      ? w(`${total} added`, `${total} ditambah`)
                      : w(`${total} changes`, `${total} perubahan`)}{" "}
                    <button
                      type="button"
                      className="agent-mini"
                      aria-expanded="false"
                      onClick={() => setOpen([...open, g.kind])}
                    >
                      {w("Show all", "Papar semua")}
                    </button>
                  </p>
                ) : (
                  <ul className="agent-changes">
                    {g.lines.map((c, i) => (
                      <li key={i} data-op={c.op}>
                        {words(changeLine(c, packName))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {suggestion && (
            <a className="agent-row" href={href("/app/test")}>
              <span className="agent-row-text">
                <b>{w("Try it first", "Cuba dahulu")}</b>
                <span>
                  {w("Ask: ", "Tanya: ")}“{words(suggestion)}”
                </span>
              </span>
              <span className="agent-chev" aria-hidden="true">
                ›
              </span>
            </a>
          )}

          {missing.length > 0 ? (
            <div className="agent-publish-block">
              <p>
                {w("Add these before you publish: ", "Tambah ini sebelum menerbitkan: ")}
                {missing
                  .map((k) => words(SETTING_FIELDS[k]))
                  .join(", ")}
                .
              </p>
              <a
                className="button button-small button-dark"
                href="#greeting"
                onClick={go("greeting")}
              >
                {w("Go to greeting and voice", "Pergi ke salam dan suara")}
              </a>
            </div>
          ) : (
            <div className="agent-bar agent-bar-one">
              <button
                type="button"
                className="button button-small button-dark"
                disabled={busy || reading}
                onClick={() => void publish()}
              >
                {busy
                  ? w("Publishing…", "Menerbitkan…")
                  : w("Publish", "Terbitkan")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
