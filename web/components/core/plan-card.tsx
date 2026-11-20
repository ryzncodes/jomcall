"use client";
// The plan card at the top of the wallet screen (local and hosted apps only;
// billing.tsx loads it behind the build-time mode switch so the mock preview
// never ships it). Reads the `plan` command and writes through `choosePlan`.
import { useEffect, useRef, useState } from "react";
import { formatSen } from "../../../packages/billing/src/money";
import type { PlanChoice } from "../../../packages/contracts/src/billing";
import { CoreError, failureOf } from "@/lib/core/client";
import {
  addMonth,
  cardState,
  dayText,
  firstFeePending,
  keepPlanKey,
  klDate,
  lastGraceDay,
  minutesUsed,
  nextFee,
  orderedPlans,
  planStopped,
  topUpNeeded,
  type PlanCode,
  type PlanOffer,
} from "@/lib/core/plan-rules";
import { HOSTED } from "@/lib/hosted";
import { WHATSAPP_WAITING_FOR_META, whatsappWaiting } from "@/lib/launch";
import { useCore, useWords, useResource, useAction, Notice } from "./state";

type Done = {
  choice: PlanChoice;
  code: PlanCode;
  feeSen: number;
  from: PlanCode;
  date: string | null;
};

export function PlanCard({
  walletBalanceSen,
  onTopUp,
}: {
  walletBalanceSen: number;
  // Takes the owner to the wallet's top-up control.
  onTopUp: (neededSen: number) => void;
}) {
  const w = useWords(),
    { client } = useCore();
  const ms = w("en", "ms") === "ms";
  const plan = useResource(() => client.execute("plan", {}), "plan");
  const choose = useAction();
  const [confirm, setConfirm] = useState<PlanCode | null>(null);
  const [changing, setChanging] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmBox = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  // One idempotency key per plan code (see pick).
  const keys = useRef(new Map<PlanCode, string>());
  // A top-up that lands (and retries an unpaid fee) changes the balance.
  const seenBalance = useRef(walletBalanceSen);
  useEffect(() => {
    if (seenBalance.current === walletBalanceSen) return;
    seenBalance.current = walletBalanceSen;
    void plan.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletBalanceSen]);
  useEffect(() => {
    if (confirm) confirmBox.current?.focus();
  }, [confirm]);

  // Staff cannot see plans: no card and no error.
  if (plan.error instanceof CoreError && plan.error.code === "FORBIDDEN")
    return null;
  if (!plan.data)
    return plan.error ? (
      <section className="core-panel core-plan-card">
        <Notice error={plan.error} />
        <button
          className="button secondary-button"
          onClick={() => void plan.reload()}
        >
          {w("Retry", "Cuba lagi")}
        </button>
      </section>
    ) : (
      <div className="core-panel core-plan-placeholder" aria-hidden="true" />
    );

  const s = plan.data;
  const state = cardState(s);
  const offers = orderedPlans(s.plans);
  const offer = (code: PlanCode) => offers.find((p) => p.code === code);
  const name = (code: PlanCode) =>
    code === "payg"
      ? w("Pay as you go", "Bayar ikut guna")
      : code === "starter"
        ? "Starter"
        : "Growth";
  const day = (date: string) => dayText(date, ms);
  const currentFee = s.feeSen || (offer(s.plan)?.feeSen ?? 0);

  const openConfirm = (code: PlanCode, button: HTMLButtonElement) => {
    opener.current = button;
    setDone(null);
    setConfirm(code);
  };
  const closeConfirm = () => {
    setConfirm(null);
    opener.current?.focus();
  };
  // A retry after no answer (offline, a proxy's page) reuses the plan code's
  // key, so it cannot charge twice. Any answer from JomCall, wallet_short or
  // an error included, ends the key: the next attempt is a new request.
  const pick = async (code: PlanCode, date: string | null) => {
    const key = keys.current.get(code) ?? crypto.randomUUID();
    keys.current.set(code, key);
    const choice = await choose.run(async () => {
      try {
        const answer = await client.execute("choosePlan", { code }, key);
        keys.current.delete(code);
        return answer;
      } catch (e) {
        if (!keepPlanKey(failureOf(e))) keys.current.delete(code);
        throw e;
      }
    });
    if (!choice) return;
    setDone({
      choice,
      code,
      feeSen: offer(code)?.feeSen ?? 0,
      from: s.plan,
      date,
    });
    setConfirm(null);
    setChanging(false);
    heading.current?.focus();
  };

  const lines = (
    p: Pick<
      PlanOffer,
      "phoneNumbers" | "includedVoiceSeconds" | "whatsappAgent"
    >,
    payg: boolean,
    used?: number,
  ) => (
    <ul className="core-plan-lines">
      <li>
        {p.phoneNumbers === 1
          ? w("1 phone number", "1 nombor telefon")
          : p.phoneNumbers
            ? w(
                `${p.phoneNumbers} phone numbers`,
                `${p.phoneNumbers} nombor telefon`,
              )
            : w("No phone number", "Tiada nombor telefon")}
        {p.phoneNumbers > 0 && (
          <>
            {" "}
            <small className="core-plan-note">
              {w(
                "(not open yet: we email you when yours is ready)",
                "(belum dibuka: kami e-mel anda apabila nombor anda sedia)",
              )}
            </small>
          </>
        )}
      </li>
      {p.includedVoiceSeconds > 0 &&
        (used === undefined ? (
          <li>
            {w(
              `${minutesUsed(0, p.includedVoiceSeconds).included} minutes of calls included`,
              `${minutesUsed(0, p.includedVoiceSeconds).included} minit panggilan termasuk`,
            )}
          </li>
        ) : (
          <li>
            {w(
              `${minutesUsed(used, p.includedVoiceSeconds).used} of ${minutesUsed(used, p.includedVoiceSeconds).included} minutes used`,
              `${minutesUsed(used, p.includedVoiceSeconds).used} daripada ${minutesUsed(used, p.includedVoiceSeconds).included} minit telah digunakan`,
            )}
          </li>
        ))}
      <li>
        {p.whatsappAgent
          ? w("WhatsApp agent included", "Ejen WhatsApp termasuk") +
            (HOSTED && WHATSAPP_WAITING_FOR_META
              ? ` (${w(...whatsappWaiting.short)})`
              : "")
          : w("No WhatsApp agent", "Tiada ejen WhatsApp")}
      </li>
      {p.whatsappAgent && (
        <li>
          {w(
            "Meta bills its own fees to your business",
            "Meta mengenakan caj sendiri terus kepada perniagaan anda",
          )}
        </li>
      )}
      {payg && (
        <li>
          {w(
            "The agent does not answer phone calls or WhatsApp on this plan. Test calls still work.",
            "Ejen tidak menjawab panggilan telefon atau WhatsApp di bawah pelan ini. Panggilan ujian masih berfungsi.",
          )}
        </li>
      )}
    </ul>
  );

  const confirmPanel = (text: string, action: string, onYes: () => void) => (
    <div
      className="core-plan-confirm"
      ref={confirmBox}
      tabIndex={-1}
      role="group"
      aria-label={text}
    >
      <p>{text}</p>
      <Notice error={choose.error} />
      <div className="core-actions">
        <button
          className="button button-dark"
          disabled={choose.busy}
          onClick={onYes}
        >
          {action}
        </button>
        <button
          className="button secondary-button"
          disabled={choose.busy}
          onClick={closeConfirm}
        >
          {w("Cancel", "Batal")}
        </button>
      </div>
    </div>
  );

  const result =
    done &&
    (() => {
      const { choice, code, feeSen, from, date } = done;
      if (choice.outcome === "started")
        return (
          <p className="core-success" role="status">
            {w(
              `${name(code)} started. ${formatSen(feeSen)} was taken from your wallet.`,
              `${name(code)} telah bermula. ${formatSen(feeSen)} telah ditolak daripada dompet anda.`,
            )}
          </p>
        );
      if (choice.outcome === "wallet_short") {
        const balance = choice.balanceSen ?? 0,
          needed = choice.neededSen ?? feeSen;
        const x = formatSen(topUpNeeded(needed, balance));
        return (
          <p className="storage-warning" role="status">
            {w(
              `Your wallet has ${formatSen(balance)}. ${name(code)} needs ${formatSen(needed)}. Top up ${x}, then start the plan.`,
              `Dompet anda ada ${formatSen(balance)}. ${name(code)} memerlukan ${formatSen(needed)}. Tambah nilai ${x}, kemudian mulakan pelan.`,
            )}
          </p>
        );
      }
      if (choice.outcome === "scheduled")
        return (
          <p className="core-success" role="status">
            {date
              ? w(
                  `${name(code)} starts on ${day(date)}. Nothing is charged today.`,
                  `${name(code)} bermula pada ${day(date)}. Tiada caj hari ini.`,
                )
              : w(
                  `${name(code)} starts at your next monthly date. Nothing is charged today.`,
                  `${name(code)} bermula pada tarikh bulanan anda yang seterusnya. Tiada caj hari ini.`,
                )}
          </p>
        );
      if (choice.outcome === "cancelled")
        return (
          <p className="core-success" role="status">
            {w(
              `Change cancelled. You stay on ${name(from)}.`,
              `Pertukaran dibatalkan. Anda kekal dengan ${name(from)}.`,
            )}
          </p>
        );
      return null;
    })();

  if (state === "choose") {
    const nextDate = day(addMonth(klDate(new Date())));
    return (
      <section
        className="core-panel core-plan-card"
        aria-labelledby="plan-card-title"
      >
        <h2 id="plan-card-title" ref={heading} tabIndex={-1}>
          {w("Choose a plan", "Pilih pelan")}
        </h2>
        {planStopped(s) && (
          <p className="storage-warning">
            {w(
              "Your plan stopped because the fee was not paid. Choose a plan to start again.",
              "Pelan anda berhenti kerana yuran tidak dibayar. Pilih pelan untuk mulakan semula.",
            )}
          </p>
        )}
        {result}
        <ul className="core-plan-choices">
          {offers.map((p) => {
            const short = topUpNeeded(p.feeSen, s.balanceSen);
            const fee = formatSen(p.feeSen);
            return (
              <li key={p.code}>
                <h3>{name(p.code)}</h3>
                <strong>
                  {p.feeSen
                    ? w(`${fee} a month`, `${fee} sebulan`)
                    : w("No monthly fee", "Tiada yuran bulanan")}
                </strong>
                {lines(p, p.code === "payg")}
                {p.feeSen > 0 &&
                  (short > 0 ? (
                    <button
                      className="button secondary-button"
                      onClick={() => onTopUp(short)}
                    >
                      {w(
                        `Top up ${formatSen(short)} to start`,
                        `Tambah nilai ${formatSen(short)} untuk bermula`,
                      )}
                    </button>
                  ) : (
                    <button
                      className="button button-dark"
                      aria-expanded={confirm === p.code}
                      disabled={choose.busy}
                      onClick={(e) => openConfirm(p.code, e.currentTarget)}
                    >
                      {w(
                        `Start ${name(p.code)} — ${fee} now`,
                        `Mulakan ${name(p.code)} — ${fee} sekarang`,
                      )}
                    </button>
                  ))}
                {confirm === p.code &&
                  confirmPanel(
                    w(
                      `Start ${name(p.code)} today? ${fee} will be taken from your wallet now. Next fee on ${nextDate}.`,
                      `Mulakan ${name(p.code)} hari ini? ${fee} akan ditolak daripada dompet anda sekarang. Yuran seterusnya pada ${nextDate}.`,
                    ),
                    w("Start plan", "Mulakan pelan"),
                    () => void pick(p.code, null),
                  )}
              </li>
            );
          })}
        </ul>
        <p className="core-voice-note">
          {w(
            "The fee is taken from your wallet today, then on the same date each month.",
            "Yuran ditolak daripada dompet anda hari ini, kemudian pada tarikh yang sama setiap bulan.",
          )}
        </p>
      </section>
    );
  }

  const next = nextFee(s);
  const firstFee = firstFeePending(s);
  const title = w(
    `Your plan: ${name(s.plan)} · ${formatSen(currentFee)} a month`,
    `Pelan anda: ${name(s.plan)} · ${formatSen(currentFee)} sebulan`,
  );
  if (state === "unpaid") {
    const x = topUpNeeded(currentFee, s.balanceSen);
    const by = s.graceUntil ? day(lastGraceDay(s.graceUntil)) : null;
    return (
      <section
        className="core-panel core-plan-card"
        aria-labelledby="plan-card-title"
      >
        <h2 id="plan-card-title" ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <p className="storage-warning">
          {x > 0
            ? w(
                `Plan fee unpaid. Top up ${formatSen(x)}${by ? ` by ${by}` : ""} or the plan stops and the agent no longer answers.`,
                `Yuran pelan belum dibayar. Tambah nilai ${formatSen(x)}${by ? ` selewat-lewatnya ${by}` : ""}, atau pelan berhenti dan ejen tidak lagi menjawab.`,
              )
            : w(
                "Plan fee unpaid. It is taken from your wallet within the hour.",
                "Yuran pelan belum dibayar. Ia akan ditolak daripada dompet anda dalam masa sejam.",
              )}
        </p>
        {x > 0 && (
          <button className="button button-dark" onClick={() => onTopUp(x)}>
            {w(`Top up ${formatSen(x)}`, `Tambah nilai ${formatSen(x)}`)}
          </button>
        )}
        {lines(s, false)}
      </section>
    );
  }

  return (
    <section
      className="core-panel core-plan-card"
      aria-labelledby="plan-card-title"
    >
      <h2 id="plan-card-title" ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {firstFee && (
        <p>
          {w(
            `Your first fee is taken from your wallet within the hour. If the wallet is short you have ${firstFee.graceDays} days to top up.`,
            `Yuran pertama anda akan ditolak daripada dompet dalam masa sejam. Jika baki tidak mencukupi, anda ada ${firstFee.graceDays} hari untuk tambah nilai.`,
          )}
        </p>
      )}
      {result}
      {/* Before the first period the entitlements read zero: show the plan's own. */}
      {lines(
        (firstFee && offer(s.plan)) || s,
        false,
        s.periodState === "charged" ? s.usedIncludedSeconds : undefined,
      )}
      {next?.kind === "stop" ? (
        <p>
          {w(
            `Your plan stops on ${day(next.date)}. After that the agent does not answer phone calls or WhatsApp.`,
            `Pelan anda berhenti pada ${day(next.date)}. Selepas itu ejen tidak menjawab panggilan telefon atau WhatsApp.`,
          )}
        </p>
      ) : next ? (
        <p>
          <strong>
            {w(
              `Next fee: ${day(next.date)} · ${formatSen(next.feeSen)}`,
              `Yuran seterusnya: ${day(next.date)} · ${formatSen(next.feeSen)}`,
            )}
          </strong>
          {s.pendingPlan && (
            <>
              <br />
              {w(
                `${name(s.pendingPlan)} starts on ${day(next.date)}.`,
                `${name(s.pendingPlan)} bermula pada ${day(next.date)}.`,
              )}
            </>
          )}
        </p>
      ) : null}
      <Notice error={confirm ? undefined : choose.error} />
      <div className="core-actions">
        {s.pendingPlan ? (
          <button
            className="button secondary-button"
            disabled={choose.busy}
            onClick={() => void pick(s.plan, null)}
          >
            {w("Cancel change", "Batalkan pertukaran")}
          </button>
        ) : (
          <button
            className="button secondary-button"
            aria-expanded={changing}
            onClick={() => setChanging((v) => !v)}
          >
            {w("Change plan", "Tukar pelan")}
          </button>
        )}
      </div>
      {changing && !s.pendingPlan && (
        <ul className="core-plan-choices">
          {offers
            .filter((p) => p.code !== s.plan)
            .map((p) => {
              const fee = formatSen(p.feeSen);
              return (
                <li key={p.code}>
                  <h3>{name(p.code)}</h3>
                  <strong>
                    {p.feeSen
                      ? w(`${fee} a month`, `${fee} sebulan`)
                      : w("No monthly fee", "Tiada yuran bulanan")}
                  </strong>
                  {lines(p, p.code === "payg")}
                  <button
                    className="button button-dark"
                    aria-expanded={confirm === p.code}
                    disabled={choose.busy}
                    onClick={(e) => openConfirm(p.code, e.currentTarget)}
                  >
                    {w(`Choose ${name(p.code)}`, `Pilih ${name(p.code)}`)}
                  </button>
                  {confirm === p.code &&
                    confirmPanel(
                      s.periodEnd
                        ? w(
                            `${name(p.code)} starts on ${day(s.periodEnd)}. Nothing is charged today.`,
                            `${name(p.code)} bermula pada ${day(s.periodEnd)}. Tiada caj hari ini.`,
                          )
                        : w(
                            `${name(p.code)} starts at your next monthly date. Nothing is charged today.`,
                            `${name(p.code)} bermula pada tarikh bulanan anda yang seterusnya. Tiada caj hari ini.`,
                          ),
                      w("Confirm change", "Sahkan pertukaran"),
                      () => void pick(p.code, s.periodEnd),
                    )}
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}
