"use client";
import { useEffect, useRef, useState } from "react";
import { CoreError } from "@/lib/core/client";
import { queuedWrite, stored } from "@/lib/core/queued-write";
import type { KnowledgeGap } from "../../../../packages/contracts/src/knowledge";
import { useExperience } from "../../experience";
import { Field } from "../field";
import { useCore, useWords, useResource, useAction, Notice } from "../state";
import {
  channelWords,
  dropDraft,
  gapConflictAction,
  gapConflictKind,
  gapTitle,
  setDraft,
  type GapDrafts,
} from "./rules";
import { useAgentPage } from "./store";

type Filter = "open" | "resolved" | "ignored";
const FILTERS: Filter[] = ["open", "resolved", "ignored"];
const KL = "Asia/Kuala_Lumpur";
const isGapConflict = (e: unknown) =>
  e instanceof CoreError && e.status === 409 && e.code === "CONFLICT";

// Unanswered questions: what customers asked and the agent could not answer.
// An answer is saved as a fact in the draft, through the page's queue.
export function Questions() {
  const w = useWords(),
    { client } = useCore(),
    { agentId, reloadKey } = useAgentPage();
  const [filter, setFilter] = useState<Filter>("open"),
    [savedIds, setSavedIds] = useState<string[]>([]),
    [handled, setHandled] = useState(false),
    [savedNote, setSavedNote] = useState(false),
    [drafts, setDrafts] = useState<GapDrafts>({});
  // The key holds the filter and the reload key, so a slow reply for an
  // earlier filter is never shown under the one now chosen.
  const list = useResource(
    () => client.execute("knowledgeGaps", { id: agentId, status: filter }),
    `${agentId}|gaps|${filter}`,
  );
  // After a conflict the list is read again in place, so the cards stay
  // mounted and keep what the owner typed.
  const seen = useRef(reloadKey);
  useEffect(() => {
    if (seen.current === reloadKey) return;
    seen.current = reloadKey;
    void list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  const names: Record<Filter, string> = {
    open: w("To answer", "Perlu dijawab"),
    resolved: w("Answered", "Dijawab"),
    ignored: w("Skipped", "Dilangkau"),
  };
  const empty: Record<Filter, string> = {
    open: w(
      "No unanswered questions. When a customer asks something the agent cannot answer, it shows up here.",
      "Tiada soalan yang belum dijawab. Apabila pelanggan bertanya sesuatu yang ejen tidak dapat jawab, ia akan muncul di sini.",
    ),
    resolved: w(
      "No answered questions yet.",
      "Belum ada soalan yang dijawab.",
    ),
    ignored: w("No skipped questions.", "Tiada soalan yang dilangkau."),
  };
  return (
    <section className="agent-view" aria-labelledby="agent-questions-h">
      <h2 id="agent-questions-h">
        {w("Questions it could not answer", "Soalan yang tidak dapat dijawab")}
      </h2>
      <p className="core-hint">
        {w(
          "Only the question is kept, never who asked.",
          "Hanya soalan disimpan, bukan siapa yang bertanya.",
        )}
      </p>
      <div className="agent-chips" role="group" aria-label={w("Show", "Papar")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="agent-chip"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setHandled(false);
              setSavedNote(false);
            }}
          >
            {names[f]}
          </button>
        ))}
      </div>
      {handled && (
        <p role="status" className="agent-notice">
          {w(
            "That question was already answered or skipped by someone else. The list is up to date.",
            "Soalan itu sudah dijawab atau dilangkau oleh orang lain. Senarai ini sudah dikemas kini.",
          )}
        </p>
      )}
      {savedNote && filter === "open" && (
        <p role="status" className="core-success">
          {w(
            "Saved. Goes live when you publish.",
            "Disimpan. Ia aktif apabila anda menerbitkan.",
          )}
        </p>
      )}
      {list.error ? (
        <Notice error={list.error} />
      ) : !list.data ? (
        <p aria-busy="true">{w("Loading...", "Memuatkan...")}</p>
      ) : !list.data.length ? (
        <p>{empty[filter]}</p>
      ) : (
        <ul className="agent-gaps">
          {list.data.map((g) => (
            <li key={g.id}>
              <GapCard
                gap={g}
                justSaved={savedIds.includes(g.id)}
                draft={drafts[g.id]}
                setDraft={(part) => setDrafts((d) => setDraft(d, g.id, part))}
                reload={list.reload}
                onStart={() => {
                  setHandled(false);
                  setSavedNote(false);
                }}
                onSaved={() => {
                  setSavedIds((s) => [...s, g.id]);
                  setDrafts((d) => dropDraft(d, g.id));
                  setSavedNote(true);
                }}
                onHandled={() => setHandled(true)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GapCard({
  gap,
  justSaved,
  draft,
  setDraft,
  reload,
  onStart,
  onSaved,
  onHandled,
}: {
  gap: KnowledgeGap;
  justSaved: boolean;
  draft: { answer: string; topic: string } | undefined;
  setDraft: (part: { answer?: string; topic?: string }) => void;
  reload: () => Promise<boolean>;
  onStart: () => void;
  onSaved: () => void;
  onHandled: () => void;
}) {
  const w = useWords(),
    { locale } = useExperience(),
    { client } = useCore(),
    { agentId, queue, refreshChanges } = useAgentPage(),
    a = useAction();
  const answer = draft?.answer ?? "",
    topic = draft?.topic ?? "";
  const ms = locale === "ms";
  const when = new Intl.DateTimeFormat(ms ? "ms-MY" : "en-MY", {
    timeZone: KL,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(gap.last_asked_at));
  const asked = ms
    ? `Ditanya ${gap.ask_count} kali`
    : `Asked ${gap.ask_count} ${gap.ask_count === 1 ? "time" : "times"}`;
  const via = channelWords(gap.channels);

  // The gap list moved under this card: show the list as it is now.
  const alreadyHandled = async () => {
    onHandled();
    await reload();
  };
  // The open gaps as they are now, or undefined when they cannot be read.
  const freshOpen = () =>
    client
      .execute("knowledgeGaps", { id: agentId, status: "open" })
      .catch(() => undefined);

  // One try at saving with the given gap revision. "stale" is a 409 that did
  // not move the agent revision, so it is about the gap; an agent conflict
  // is rethrown and takes the normal route (the page reloads).
  const trySave = async (gapRevision: number, text: string) => {
    let result: { revision: number } | undefined,
      stale = false;
    await queuedWrite(queue, async (revision, key) => {
      try {
        await client.execute(
          "resolveGap",
          {
            agentId,
            id: gap.id,
            as: "fact",
            expectedRevision: gapRevision,
            expectedAgentRevision: revision,
            title: gapTitle(topic, text),
            value: text,
          },
          key,
        );
        // Saving adds a fact: the agent revision moved by one. Read where
        // it stands; if that read fails the write still stands.
        let next = revision + 1;
        try {
          next = (await client.execute("draft", { id: agentId })).revision;
        } catch {
          /* the plus-one above is what the server did */
        }
        result = { revision: next };
        return result;
      } catch (e) {
        if (isGapConflict(e)) {
          const d = await client.execute("draft", { id: agentId });
          if (gapConflictKind(revision, d.revision) === "gap") {
            stale = true;
            return { revision: d.revision };
          }
        }
        throw e;
      }
    });
    return stale ? ("stale" as const) : result ? ("stored" as const) : ("none" as const);
  };

  const save = () => {
    const text = answer.trim();
    if (!text) return;
    onStart();
    return a.run(async () => {
      let outcome = await trySave(gap.revision, text);
      if (outcome === "stale") {
        // A new ask also moves the gap's revision: look before deciding.
        const todo = gapConflictAction(await freshOpen(), gap.id, 0);
        if (todo.kind === "handled") {
          await alreadyHandled();
          return false;
        }
        if (todo.kind === "error") throw new CoreError("CONFLICT", 409);
        outcome = await trySave(todo.revision, text);
        if (outcome === "stale") throw new CoreError("CONFLICT", 409);
      }
      return stored(outcome === "stored" ? { revision: 0 } : undefined, async () => {
        onSaved();
        refreshChanges();
        await reload();
      });
    });
  };

  const skip = () => {
    onStart();
    return a.run(async () => {
      const send = (expectedRevision: number) =>
        client.execute("ignoreGap", { agentId, id: gap.id, expectedRevision });
      try {
        await send(gap.revision);
      } catch (e) {
        if (!isGapConflict(e)) throw e;
        const todo = gapConflictAction(await freshOpen(), gap.id, 0);
        if (todo.kind === "handled") {
          await alreadyHandled();
          return false;
        }
        if (todo.kind === "error") throw e;
        await send(todo.revision);
      }
      await reload();
      return true;
    });
  };

  return (
    <article className="agent-card agent-gap">
      <h3>{gap.question}</h3>
      <p className="agent-gap-meta">
        {asked}
        {via.en && (
          <>
            {" · "}
            {ms ? via.ms : via.en}
          </>
        )}
        {" · "}
        <time dateTime={gap.last_asked_at}>
          {w("Last asked", "Kali terakhir ditanya")} {when}
        </time>
      </p>
      {gap.status === "open" ? (
        <>
          <Notice {...a} saved={false} />
          <fieldset className="agent-lock" disabled={a.busy}>
            <div className="builder-fields">
              <Field label={w("Your answer", "Jawapan anda")}>
                <textarea
                  rows={3}
                  maxLength={4000}
                  placeholder={w(
                    "What the agent should say",
                    "Apa yang ejen patut cakap",
                  )}
                  value={answer}
                  onChange={(e) => setDraft({ answer: e.target.value })}
                />
              </Field>
              <Field label={w("Topic (optional)", "Topik (pilihan)")}>
                <input
                  maxLength={200}
                  placeholder={w("For example: Sunday hours", "Contoh: Waktu hari Ahad")}
                  value={topic}
                  onChange={(e) => setDraft({ topic: e.target.value })}
                />
              </Field>
            </div>
            <div className="core-actions">
              <button
                type="button"
                className="button button-dark"
                disabled={a.busy || !answer.trim()}
                onClick={() => void save()}
              >
                {w("Save answer", "Simpan jawapan")}
              </button>
              <button type="button" disabled={a.busy} onClick={() => void skip()}>
                {w("We do not answer this", "Kami tidak jawab soalan ini")}
              </button>
            </div>
          </fieldset>
        </>
      ) : gap.status === "resolved" ? (
        <>
          <p className="agent-gap-answer">
            {gap.answer_removed || gap.resolved_answer === null
              ? w("This answer was removed", "Jawapan ini telah dibuang")
              : gap.resolved_answer}
          </p>
          {justSaved && (
            <p role="status" className="core-success">
              {w(
                "Saved. Goes live when you publish.",
                "Disimpan. Ia aktif apabila anda menerbitkan.",
              )}
            </p>
          )}
        </>
      ) : (
        <p className="agent-gap-meta">
          {w("Skipped. You chose not to answer this.", "Dilangkau. Anda memilih untuk tidak menjawabnya.")}
        </p>
      )}
    </article>
  );
}
