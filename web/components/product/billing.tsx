"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Wallet,
  Receipt,
  Phone,
  ChatCircleDots,
  ArrowClockwise,
  DownloadSimple,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { useProduct } from "./provider";
import { useCrm } from "./crm-provider";
import { AppShell } from "./shell";
import { CrmDialog, dateLabel, downloadJson } from "./crm-ui";
import { serviceApi, walletBalance, type Payment } from "@/lib/api/service";
import { money } from "@/lib/api/client";
export function Billing() {
  const { t, locale, href } = useExperience(),
    p = t.services,
    { draft: d, update } = useProduct(),
    { data } = useCrm();
  const [tab, setTab] = useState("activity"),
    [payment, setPayment] = useState<Payment | null>(null),
    [receiptId, setReceiptId] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [source, setSource] = useState("");
  const pending = d?.services.payments.find((x) => x.status === "unknown"),
    candidates =
      data && d
        ? serviceApi
            .candidates(data)
            .filter((u) => !d.services.usage.some((x) => x.id === u.id))
        : [],
    usage = candidates.find((x) => x.id === source) ?? candidates[0];
  const activePayment = d?.services.payments.find((x) => x.id === payment?.id),
    receipt = d?.wallet_ledger.find((x) => x.id === receiptId),
    receipts = d?.wallet_ledger.filter((x) => x.reason === "topup") ?? [];
  const openPayment = () => {
    if (!d) return;
    setError("");
    setPayment(
      pending ?? {
        id: crypto.randomUUID(),
        org_id: d.organization.id,
        amount_sen: 5000,
        method: "fpx",
        status: "unknown",
        created_at: new Date().toISOString(),
      },
    );
  };
  const pay = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!payment) return;
    const f = new FormData(e.currentTarget);
    const next: Payment = {
      ...payment,
      amount_sen: activePayment ? payment.amount_sen : Number(f.get("amount")),
      method: activePayment
        ? payment.method
        : (String(f.get("method")) as Payment["method"]),
      status: String(f.get("outcome")) as Payment["status"],
    };
    update((v) => serviceApi.payment(v, next));
    setPayment(next);
    setNotice(
      next.status === "paid"
        ? p.paymentSuccess
        : next.status === "failed"
          ? p.paymentFailed
          : p.paymentUnknown,
    );
    if (next.status === "paid") {
      setPayment(null);
      setReceiptId(next.id);
    }
  };
  return (
    <AppShell active="billing">
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main service-main"
      >
        <div className="product-page-heading">
          <div>
            <h1>{p.billingTitle}</h1>
            <p>{p.billingIntro}</p>
          </div>
          <span className="crm-heading-icon">
            <Wallet size={32} weight="light" />
          </span>
        </div>
        {d ? (
          <>
            {pending && (
              <div className="billing-alert">
                <p>{p.paymentUnknown}</p>
                <button
                  className="crm-text-button"
                  onClick={() => setPayment(pending)}
                >
                  {p.checkPayment}
                </button>
              </div>
            )}
            <div className="billing-overview">
              <section className="wallet-card">
                <div>
                  <Wallet size={22} />
                  <span>{p.balance}</span>
                </div>
                <strong className="wallet-amount">
                  {money(walletBalance(d))}
                </strong>
                <p>{p.balanceHint}</p>
                <div className="service-actions">
                  <button className="button wallet-topup" onClick={openPayment}>
                    <Plus size={18} />
                    {pending ? p.checkPayment : p.topup}
                  </button>
                  {!d.wallet_ledger.some((l) => l.reason === "trial") ? (
                    <button
                      className="wallet-trial"
                      onClick={() => {
                        update((v) =>
                          v.wallet_ledger.some((l) => l.reason === "trial")
                            ? v
                            : {
                                ...v,
                                wallet_ledger: [
                                  ...v.wallet_ledger,
                                  {
                                    id: "sample-trial",
                                    org_id: v.organization.id,
                                    amount_sen: 2000,
                                    reason: "trial",
                                    created_at: new Date().toISOString(),
                                  },
                                ],
                              },
                        );
                        setNotice(p.trialAdded);
                      }}
                    >
                      {p.trial}
                    </button>
                  ) : (
                    <span className="wallet-trial-added">{p.trialAdded}</span>
                  )}
                </div>
              </section>
              <section className="usage-overview" aria-label={p.usage}>
                <h2>{p.usage}</h2>
                {(["voice", "message"] as const).map((kind) => {
                  const rows = d.services.usage.filter((u) => u.kind === kind),
                    qty = rows.reduce((n, u) => n + u.quantity, 0);
                  return (
                    <div className="usage-line" key={kind}>
                      <span className="usage-icon">
                        {kind === "voice" ? (
                          <Phone size={20} />
                        ) : (
                          <ChatCircleDots size={20} />
                        )}
                      </span>
                      <div>
                        <strong>{p[kind]}</strong>
                        <small>
                          {kind === "voice"
                            ? (qty / 60).toLocaleString(locale, {
                                maximumFractionDigits: 1,
                              })
                            : qty}{" "}
                          {kind === "voice" ? p.minutes : p.messages}
                        </small>
                      </div>
                      <strong>
                        {money(rows.reduce((n, u) => n + u.amount_sen, 0))}
                      </strong>
                    </div>
                  );
                })}
                <p>{p.charged}</p>
              </section>
            </div>
            <div className="billing-grid">
              <section className="billing-ledger">
                <div className="billing-tabs">
                  {(["activity", "receipts"] as const).map((key) => (
                    <button
                      key={key}
                      aria-pressed={tab === key}
                      onClick={() => setTab(key)}
                    >
                      {p[key]}
                      {key === "receipts" && <span>{receipts.length}</span>}
                    </button>
                  ))}
                </div>
                {(tab === "receipts" ? receipts : d.wallet_ledger)
                  .slice()
                  .reverse()
                  .map((l) => (
                    <div className="ledger-row" key={l.id}>
                      <span
                        className={`ledger-icon ${l.amount_sen < 0 ? "debit" : ""}`}
                      >
                        {l.amount_sen < 0 ? (
                          <ArrowUpRight size={19} />
                        ) : (
                          <ArrowDownLeft size={19} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {l.reason === "trial"
                            ? p.trialCredit
                            : l.reason === "usage"
                              ? p.usageDebit
                              : p.topupCredit}
                        </strong>
                        <small>
                          {l.created_at
                            ? dateLabel(l.created_at, locale)
                            : p.earlierSetup}
                          {l.method ? ` · ${p[l.method]}` : ""}
                        </small>
                      </div>
                      <div className="ledger-amount">
                        <strong>
                          {l.amount_sen > 0 ? "+" : ""}
                          {money(l.amount_sen)}
                        </strong>
                        {l.reason === "topup" && (
                          <button onClick={() => setReceiptId(l.id)}>
                            {p.viewReceipt}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                {!(tab === "receipts" ? receipts : d.wallet_ledger).length && (
                  <div className="crm-empty">
                    <Receipt size={34} weight="light" />
                    <p>
                      {tab === "receipts" ? p.emptyReceipts : p.emptyLedger}
                    </p>
                  </div>
                )}
                {d.services.payments.some((x) => x.status !== "paid") && (
                  <div className="payment-attempts">
                    <h3>{p.paymentAttempts}</h3>
                    {d.services.payments
                      .filter((x) => x.status !== "paid")
                      .map((x) => (
                        <div key={x.id}>
                          <span>
                            {money(x.amount_sen)} · {p[x.method]}
                            <small>{p[x.status]}</small>
                          </span>
                          <button
                            className="crm-text-button"
                            onClick={() => setPayment(x)}
                            disabled={!!pending && pending.id !== x.id}
                          >
                            {x.status === "unknown" ? p.checkPayment : p.retry}
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </section>
              <aside className="auto-topup">
                <span className="auto-topup-icon">
                  <ArrowClockwise size={25} />
                </span>
                <h2>{p.auto}</h2>
                <p>{p.autoHelp}</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget),
                      threshold = Number(f.get("threshold")),
                      amount = Number(f.get("amount"));
                    if (amount <= threshold) {
                      setError(p.autoInvalid);
                      return;
                    }
                    update((v) => ({
                      ...v,
                      services: {
                        ...v.services,
                        auto_topup: {
                          enabled: f.get("enabled") === "on",
                          threshold_sen: threshold,
                          amount_sen: amount,
                        },
                      },
                    }));
                    setError("");
                    setNotice(p.saved);
                  }}
                  key={`${d.services.auto_topup.enabled}-${d.services.auto_topup.threshold_sen}-${d.services.auto_topup.amount_sen}`}
                >
                  <label className="crm-switch-row">
                    <span>{p.autoEnabled}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      name="enabled"
                      defaultChecked={d.services.auto_topup.enabled}
                    />
                  </label>
                  <label className="product-field">
                    {p.threshold}
                    <select
                      name="threshold"
                      aria-label={p.threshold}
                      defaultValue={d.services.auto_topup.threshold_sen}
                    >
                      {[1000, 2500, 5000].map((a) => (
                        <option key={a} value={a}>
                          {money(a)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="product-field">
                    {p.amount}
                    <select
                      name="amount"
                      aria-label={p.amount}
                      defaultValue={d.services.auto_topup.amount_sen}
                    >
                      {[2500, 5000, 10000, 20000].map((a) => (
                        <option key={a} value={a}>
                          {money(a)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button secondary-button">{p.save}</button>
                </form>
                {error && (
                  <p className="crm-form-error" role="alert">
                    {error}
                  </p>
                )}
                {pending && <p className="service-note">{p.autoPending}</p>}
              </aside>
            </div>
            <p className="crm-notice" role="status">
              {notice}
            </p>
            <details className="billing-simulation">
              <summary>{p.usageSimulation}</summary>
              <p>{p.usageHelp}</p>
              {usage ? (
                <div className="usage-controls">
                  <label className="product-field">
                    {p.usageSource}
                    <select
                      aria-label={p.usageSource}
                      value={usage.id}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      {candidates.map((u, i) => (
                        <option key={u.id} value={u.id}>
                          {p[u.kind]} {i + 1} · {money(u.amount_sen)} ·{" "}
                          {dateLabel(u.at, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button secondary-button"
                    disabled={walletBalance(d) < usage.amount_sen}
                    onClick={() => {
                      update((v) => serviceApi.charge(v, usage));
                      setNotice(p.usageDone);
                    }}
                  >
                    {p.charge}
                  </button>
                  {walletBalance(d) < usage.amount_sen && (
                    <p className="service-note">{p.insufficient}</p>
                  )}
                </div>
              ) : (
                <p>{p.noUsage}</p>
              )}
              <a className="crm-text-button" href={href("/app/calls")}>
                {p.usageLink}
                <ArrowUpRight size={15} />
              </a>
            </details>
            <footer className="service-footer">{p.localNote}</footer>
            {payment && (
              <CrmDialog
                title={
                  activePayment?.status === "unknown"
                    ? p.checkPayment
                    : activePayment?.status === "failed"
                      ? p.retry
                      : p.topup
                }
                description={
                  activePayment?.status === "unknown"
                    ? p.paymentUnknown
                    : activePayment?.status === "failed"
                      ? p.paymentFailed
                      : p.paymentNote
                }
                onClose={() => setPayment(null)}
              >
                <form onSubmit={pay}>
                  {activePayment ? (
                    <div className="payment-fixed">
                      <strong>{money(payment.amount_sen)}</strong>
                      <span>{p[payment.method]}</span>
                      <small>{payment.id.slice(0, 8)}</small>
                    </div>
                  ) : (
                    <>
                      <label className="product-field">
                        {p.amount}
                        <select
                          name="amount"
                          aria-label={p.amount}
                          defaultValue={payment.amount_sen}
                        >
                          {[2500, 5000, 10000, 20000].map((a) => (
                            <option key={a} value={a}>
                              {money(a)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="product-field">
                        {p.method}
                        <select
                          name="method"
                          aria-label={p.method}
                          defaultValue={payment.method}
                        >
                          <option value="fpx">{p.fpx}</option>
                          <option value="duitnow">{p.duitnow}</option>
                        </select>
                      </label>
                    </>
                  )}
                  <label className="product-field">
                    {p.outcome}
                    <select
                      name="outcome"
                      aria-label={p.outcome}
                      defaultValue="paid"
                    >
                      <option value="paid">{p.paid}</option>
                      <option value="failed">{p.failed}</option>
                      {!activePayment && (
                        <option value="unknown">{p.unknown}</option>
                      )}
                    </select>
                  </label>
                  <button className="button button-dark">
                    {activePayment?.status === "unknown"
                      ? p.checkPayment
                      : activePayment?.status === "failed"
                        ? p.retry
                        : p.pay}
                  </button>
                </form>
              </CrmDialog>
            )}
            {receipt && (
              <CrmDialog
                title={p.receipt}
                description={p.receiptNote}
                onClose={() => setReceiptId(null)}
              >
                <div className="receipt-paper">
                  <header>
                    <Receipt size={26} />
                    <strong>{d.organization.name}</strong>
                    <span>{p.paid}</span>
                  </header>
                  <div className="receipt-total">
                    <span>{p.total}</span>
                    <strong>{money(receipt.amount_sen)}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>{p.date}</dt>
                      <dd>
                        {receipt.created_at
                          ? dateLabel(receipt.created_at, locale)
                          : p.earlierSetup}
                      </dd>
                    </div>
                    <div>
                      <dt>{p.method}</dt>
                      <dd>{p[receipt.method ?? "mock"]}</dd>
                    </div>
                    <div>
                      <dt>{p.receiptId}</dt>
                      <dd>{receipt.id}</dd>
                    </div>
                  </dl>
                </div>
                <button
                  className="button secondary-button"
                  onClick={() =>
                    downloadJson(
                      JSON.stringify(
                        {
                          sample: true,
                          not_proof_of_payment: true,
                          organization: d.organization.name,
                          receipt,
                        },
                        null,
                        2,
                      ),
                      `sample-receipt-${receipt.id}.json`,
                    )
                  }
                >
                  <DownloadSimple size={17} />
                  {p.download}
                </button>
              </CrmDialog>
            )}
          </>
        ) : (
          <div className="skeleton" aria-busy="true" />
        )}
      </main>
    </AppShell>
  );
}
