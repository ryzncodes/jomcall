"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  ChatCircleDots,
  Trash,
  CheckCircle,
  Clock,
  Headphones,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { AppShell } from "./shell";
import { useProduct } from "./provider";
import { CallTest, Transcript } from "./call-test";
import { productApi } from "@/lib/api/product";
import type {
  CallScenario,
  SetupDraft,
  TestTurn,
} from "@/lib/api/product-types";
function ChatTest({ draft }: { draft: SetupDraft }) {
  const { t, locale } = useExperience(),
    p = t.product;
  const [messages, setMessages] = useState<TestTurn[]>([]),
    [input, setInput] = useState(""),
    [pending, setPending] = useState(false),
    [fail, setFail] = useState(false),
    [failed, setFailed] = useState<string | null>(null);
  const request = useRef(0),
    serial = useRef(0),
    started = useRef(Date.now());
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const send = async (text: string, retry = false) => {
    if (pending || !text.trim()) return;
    const id = ++request.current;
    setPending(true);
    setFailed(null);
    setInput("");
    if (!retry)
      setMessages((m) => [
        ...m,
        {
          id: `chat-${++serial.current}`,
          role: "caller",
          text: text.trim(),
          at_seconds: Math.floor((Date.now() - started.current) / 1000),
        },
      ]);
    try {
      if (fail) {
        setFail(false);
        await productApi.simulate(true);
      }
      const reply = await productApi.reply(draft, locale, text);
      if (id === request.current)
        setMessages((m) => [
          ...m,
          ...reply.map((turn) => ({
            ...turn,
            id: `chat-${++serial.current}`,
            at_seconds: Math.floor((Date.now() - started.current) / 1000),
          })),
        ]);
    } catch {
      if (id === request.current) setFailed(text);
    } finally {
      if (id === request.current) setPending(false);
    }
  };
  return (
    <section
      id="test-chat"
      className="chat-test-panel"
      aria-label={p.chatTitle}
    >
      <header className="test-panel-header">
        <span className="panel-icon">
          <ChatCircleDots size={21} />
        </span>
        <div>
          <h2>{p.chatTitle}</h2>
          <p>{p.chatIntro}</p>
        </div>
        <button
          className="quiet-icon"
          aria-label={p.clearChat}
          onClick={() => {
            request.current++;
            setMessages([]);
            setPending(false);
            setFailed(null);
            setInput("");
            started.current = Date.now();
          }}
          disabled={!messages.length}
        >
          <Trash size={19} />
        </button>
      </header>
      <Transcript turns={messages} empty={p.chatEmpty} chat />
      {messages.length === 0 && (
        <div className="chat-prompts" aria-label={p.chatPromptLabel}>
          {Object.entries(p.scenarioPrompts).map(([key, text]) => (
            <button key={key} disabled={pending} onClick={() => send(text)}>
              {text}
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>
      )}
      {pending && (
        <p className="chat-pending" role="status">
          <span className="status-dot" />
          {p.sending}
        </p>
      )}
      {failed && (
        <div className="product-error" role="alert">
          <p>{p.chatError}</p>
          <button className="text-button" onClick={() => send(failed, true)}>
            {p.retryMessage}
          </button>
        </div>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label className="sr-only" htmlFor="test-message">
          {p.chatTitle}
        </label>
        <textarea
          id="test-message"
          value={input}
          maxLength={500}
          rows={2}
          placeholder={p.chatPlaceholder}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button aria-label={p.send} disabled={pending || !input.trim()}>
          <ArrowUp size={20} />
        </button>
      </form>
      <details className="recovery-controls">
        <summary>{p.recovery}</summary>
        <label className="product-check">
          <input
            type="checkbox"
            checked={fail}
            onChange={(e) => setFail(e.target.checked)}
            disabled={pending}
          />
          <span>{p.chatFail}</span>
        </label>
      </details>
    </section>
  );
}
export function AgentTestPanel() {
  const { t, href } = useExperience(),
    p = t.product,
    { draft, update } = useProduct();
  const [history, setHistory] = useState<
    { id: number; complete: boolean; scenario: CallScenario }[]
  >([]);
  return (
    <AppShell active="test">
      <main
        tabIndex={-1}
        className="workspace-main product-main"
        id="workspace-content"
      >
        <div className="product-page-heading">
          <div>
            <p className="eyebrow">{p.draftVersion}</p>
            <h1>{p.labTitle}</h1>
            <p>{p.labIntro}</p>
          </div>
          <a className="button secondary-button" href={href("/app/setup")}>
            {p.configure}
            <ArrowUpRight size={17} />
          </a>
        </div>
        {!draft ? (
          <p role="status">{p.loading}</p>
        ) : (
          <>
            <div className="test-context">
              <div className="workspace-avatar">C</div>
              <div>
                <strong>{draft.organization.name}</strong>
                <span>
                  {draft.location.name} ·{" "}
                  {draft.agent.languages
                    .map(
                      (l) => p.languageNames[l as keyof typeof p.languageNames],
                    )
                    .join(" / ")}
                </span>
              </div>
              <span className="context-status">
                <span className="status-dot" />
                {p.connectionReady}
              </span>
            </div>
            <nav className="test-section-links" aria-label={p.testLab}>
              <a href="#test-call">
                <Headphones size={17} />
                {p.browserCall}
              </a>
              <a href="#test-chat">
                <ChatCircleDots size={17} />
                {p.chatTitle}
              </a>
            </nav>
            <div className="test-lab-grid">
              <CallTest
                draft={draft}
                onStart={() =>
                  update((d) => ({ ...d, step: Math.min(d.step, 6) }), true)
                }
                onComplete={(complete, scenario) => {
                  update((d) => ({ ...d, test_passed: complete }));
                  setHistory((h) =>
                    [{ id: Date.now(), complete, scenario }, ...h].slice(0, 3),
                  );
                }}
              />
              <ChatTest draft={draft} />
            </div>
            <section className="test-history">
              <div>
                <h2>{p.testSummary}</h2>
                <p>{p.noChanges}</p>
              </div>
              <div>
                {history.length === 0 ? (
                  <p className="empty-history">{p.noTests}</p>
                ) : (
                  history.map((h) => (
                    <div className="history-row" key={h.id}>
                      {h.complete ? (
                        <CheckCircle size={20} />
                      ) : (
                        <Clock size={20} />
                      )}
                      <strong>{p.scenarios[h.scenario]}</strong>
                      <span>{h.complete ? p.completedTest : p.endedTest}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}
