"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatSen } from "../../../packages/billing/src/money";
import { topupAmounts } from "../../../packages/contracts/src/billing";
import type { Topup, LedgerEntry } from "../../../packages/contracts/src/billing";
import { useCore, useWords, useResource, useAction, Heading, Notice, Loading } from "./state";
import { CoreError } from "@/lib/core/client";

type CurlecHandoff = Extract<NonNullable<Topup["checkout"]>, { kind: "curlec" }>;
type CheckoutWindow = Window & { Razorpay?: new (options: Record<string, unknown>) => { open(): void } };

// Loads Curlec's Standard Checkout only when an owner pays. FPX needs the
// redirect flow, so the result comes back to /api/billing/return/curlec,
// never to this page's JavaScript.
function openCurlec(c: CurlecHandoff) {
  return new Promise<void>((resolve, reject) => {
    const w = window as CheckoutWindow;
    const open = () => {
      if (!w.Razorpay) return reject(new CoreError("PAYMENT_PROVIDER_UNAVAILABLE", 502));
      new w.Razorpay({
        key: c.keyId,
        amount: c.amountSen,
        currency: c.currency,
        name: c.name,
        description: c.description,
        order_id: c.orderId,
        prefill: { email: c.prefillEmail },
        callback_url: c.callbackUrl,
        redirect: true,
        modal: { ondismiss: () => resolve() },
      }).open();
      resolve();
    };
    if (w.Razorpay) return open();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = open;
    script.onerror = () => reject(new CoreError("PAYMENT_PROVIDER_UNAVAILABLE", 502));
    document.head.appendChild(script);
  });
}

const when = (iso: string, ms: boolean) =>
  new Date(iso).toLocaleString(ms ? "ms-MY" : "en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  });

export function LocalBilling() {
  const w = useWords(),
    { client, workspace } = useCore();
  const ms = w("en", "ms") === "ms";
  const returned = useSearchParams().get("payment");
  const manager = workspace.role !== "staff";
  const wallet = useResource(() => client.execute("wallet", {}), "wallet");
  const ledger = useResource(() => client.execute("walletLedger", { limit: 25 }), "ledger");
  const usage = useResource(() => client.execute("usageEvents", { limit: 25 }), "usage");
  const topups = useResource(() => client.execute("topups", { limit: 10 }), "topups");
  const receipts = useResource(() => client.execute("receipts", { limit: 10 }), "receipts");
  const trial = useAction(),
    pay = useAction(),
    check = useAction();
  const [amount, setAmount] = useState<number>(topupAmounts[1]);

  if (!manager)
    return (
      <>
        <Heading
          title={w("Billing is for owners and admins.", "Bil hanya untuk pemilik dan pentadbir.")}
          description={w("Ask the workspace owner about credit and receipts.", "Tanya pemilik ruang kerja tentang kredit dan resit.")}
        />
      </>
    );
  if (!wallet.data) return <Loading error={wallet.error} />;
  const v = wallet.data;
  const connected = v.provider.configured;
  const stateText: Record<string, [string, string]> = {
    unfunded: ["No credit yet", "Belum ada kredit"],
    ok: ["Credit available", "Kredit mencukupi"],
    low: ["Credit running low", "Kredit hampir habis"],
    grace: ["Below zero: top up soon", "Di bawah sifar: tambah nilai segera"],
    exhausted: ["Credit used up", "Kredit telah habis"],
  };
  const kindText: Record<LedgerEntry["kind"], [string, string]> = {
    topup: ["Top-up", "Tambah nilai"],
    trial_credit: ["Trial credit", "Kredit percubaan"],
    usage: ["Usage", "Penggunaan"],
    refund: ["Refund", "Bayaran balik"],
    adjustment: ["Adjustment", "Pelarasan"],
    plan_fee: ["Monthly plan fee", "Yuran pelan bulanan"],
  };
  const topupText: Record<Topup["state"], [string, string]> = {
    created: ["Starting", "Bermula"],
    pending: ["Waiting for payment", "Menunggu bayaran"],
    paid: ["Paid", "Dibayar"],
    failed: ["Not completed", "Tidak selesai"],
    expired: ["Expired", "Tamat tempoh"],
    review: ["Held for review", "Ditahan untuk semakan"],
  };
  const usageText: Record<string, [string, string]> = {
    voice_second: ["Voice", "Suara"],
    whatsapp_conversation: ["WhatsApp conversation", "Perbualan WhatsApp"],
    typed_turn: ["Typed reply", "Balasan bertulis"],
  };
  const pick = (t: [string, string] | undefined, fallback: string) => (t ? t[ms ? 1 : 0] : fallback);
  const price = (kind: string) => v.prices.find((p) => p.kind === kind);
  const voice = price("voice_second");
  const pendingFake = topups.data?.items.find((t) => t.provider === "fake" && t.state === "pending");
  return (
    <>
      <Heading
        title={w("Credit that lasts as long as your calls.", "Kredit seiring panggilan anda.")}
        description={w(
          "A prepaid wallet in ringgit. Calls and messages draw from it; top up when it runs low.",
          "Dompet prabayar dalam ringgit. Panggilan dan mesej ditolak daripadanya; tambah nilai apabila hampir habis.",
        )}
      />
      {returned && (
        <p className={returned === "received" ? "core-success" : "storage-warning"} role="status">
          {returned === "received"
            ? w("Payment received. Your credit has been added.", "Bayaran diterima. Kredit anda telah ditambah.")
            : returned === "review"
              ? w(
                  "Payment received but it needs a check before credit is added. We will sort it out; do not pay again.",
                  "Bayaran diterima tetapi perlu disemak sebelum kredit ditambah. Kami akan uruskannya; jangan bayar semula.",
                )
              : returned === "unverified"
                ? w(
                    "We could not confirm that payment page. If money left your account, credit appears once Curlec confirms it.",
                    "Kami tidak dapat mengesahkan halaman bayaran itu. Jika wang telah keluar dari akaun anda, kredit dipaparkan selepas Curlec mengesahkannya.",
                  )
                : w(
                    "Back from payment. Credit appears once the payment is confirmed; do not pay again.",
                    "Kembali daripada pembayaran. Kredit dipaparkan selepas bayaran disahkan; jangan bayar semula.",
                  )}
        </p>
      )}
      <div className="core-overview core-billing-overview">
        <div>
          <span>{w("Balance", "Baki")}</span>
          <strong data-state={v.state}>{formatSen(v.balanceSen)}</strong>
          <small>{pick(stateText[v.state], v.state)}</small>
        </div>
        <div>
          <span>{w("Voice rate", "Kadar suara")}</span>
          <strong>{voice ? formatSen(Math.round((voice.unit_sen * 60) / voice.per_quantity)) : "—"}</strong>
          <small>{w("per minute, billed by the second", "seminit, dikira mengikut saat")}</small>
        </div>
        <div>
          <span>{w("Payments", "Pembayaran")}</span>
          <strong>
            {connected
              ? v.provider.name === "fake"
                ? w("Simulated", "Simulasi")
                : v.provider.sandbox
                  ? w("Sandbox", "Kotak pasir")
                  : w("Connected", "Disambungkan")
              : w("Not connected", "Belum disambungkan")}
          </strong>
          <small>
            {connected
              ? v.provider.name === "fake"
                ? w("Local test provider; no money moves", "Penyedia ujian setempat; tiada wang berpindah")
                : "Curlec"
              : w("Top-ups open once a payment provider is set up", "Tambah nilai dibuka selepas penyedia pembayaran disediakan")}
          </small>
        </div>
      </div>
      {(v.state === "low" || v.state === "grace" || v.state === "exhausted") && (
        <div className="storage-warning" role="alert">
          {v.state === "exhausted"
            ? w(
                "Your agent will not answer new calls or chats until you top up. Calls already in progress finish normally.",
                "Ejen anda tidak akan menjawab panggilan atau sembang baharu sehingga anda tambah nilai. Panggilan yang sedang berjalan diteruskan.",
              )
            : w(
                `Your balance is at or below ${formatSen(v.lowThresholdSen)}. Service continues until ${formatSen(v.graceFloorSen)}.`,
                `Baki anda pada atau di bawah ${formatSen(v.lowThresholdSen)}. Perkhidmatan diteruskan sehingga ${formatSen(v.graceFloorSen)}.`,
              )}
        </div>
      )}
      <div className="core-two-columns">
        <section className="core-panel">
          <h2>{w("Top up", "Tambah nilai")}</h2>
          <Notice error={pay.error} />
          {!connected ? (
            <>
              <span className="remaining-chip">{w("Not connected", "Belum disambungkan")}</span>
              <p>
                {w(
                  "No payment provider is configured, so no payment can be taken. Your balance and usage below are real records.",
                  "Tiada penyedia pembayaran ditetapkan, jadi tiada bayaran boleh diterima. Baki dan penggunaan di bawah ialah rekod sebenar.",
                )}
              </p>
            </>
          ) : (
            <form
              className="core-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await pay.run(async () => {
                  const t = await client.execute("startTopup", { amountSen: amount });
                  if (t.checkout?.kind === "curlec") await openCurlec(t.checkout);
                  return t;
                });
              }}
            >
              <fieldset className="core-amounts">
                <legend>{w("Amount", "Jumlah")}</legend>
                {topupAmounts.map((a) => (
                  <label key={a}>
                    <input type="radio" name="amount" checked={amount === a} onChange={() => setAmount(a)} />
                    <span>{formatSen(a)}</span>
                  </label>
                ))}
              </fieldset>
              <p className="core-voice-note">
                {v.provider.name === "curlec"
                  ? w(
                      "Pay by FPX online banking, Visa or Mastercard, or an e-wallet, through Curlec.",
                      "Bayar melalui perbankan dalam talian FPX, Visa atau Mastercard, atau e-dompet, melalui Curlec.",
                    )
                  : w("Simulated FPX payment.", "Bayaran FPX simulasi.")}
              </p>
              <button className="button button-dark" disabled={pay.busy}>
                {w(`Pay ${formatSen(amount)}`, `Bayar ${formatSen(amount)}`)}
              </button>
            </form>
          )}
          {pendingFake && (
            <p className="core-voice-note">
              {w("Simulated payment waiting. Complete it with:", "Bayaran simulasi menunggu. Lengkapkan dengan:")}
              <br />
              <code>npm run billing:simulate -- paid {pendingFake.provider_ref}</code>
            </p>
          )}
          {!v.trialClaimed && (
            <div className="core-actions">
              <Notice error={trial.error} />
              <button
                className="button secondary-button"
                disabled={trial.busy}
                onClick={() => trial.run(() => client.execute("claimTrial", {}))}
              >
                {w(`Claim ${formatSen(v.trialCreditSen)} trial credit`, `Tuntut kredit percubaan ${formatSen(v.trialCreditSen)}`)}
              </button>
            </div>
          )}
        </section>
        <section className="core-panel">
          <h2>{w("Recent top-ups", "Tambah nilai terkini")}</h2>
          <Notice error={check.error} />
          {check.saved && (
            <p className="core-success" role="status">
              {w("Checked with the payment provider. The status below is current.", "Disemak dengan penyedia pembayaran. Status di bawah adalah terkini.")}
            </p>
          )}
          {!topups.data ? (
            <Loading error={topups.error} />
          ) : !topups.data.items.length ? (
            <p className="core-empty">{w("No top-ups yet.", "Belum ada tambah nilai.")}</p>
          ) : (
            <ul className="core-billing-list">
              {topups.data.items.map((t) => (
                <li key={t.id}>
                  <span>
                    <strong>{formatSen(t.amount_sen)}</strong>
                    <small>{when(t.created_at, ms)}</small>
                  </span>
                  <span>
                    {pick(topupText[t.state], t.state)}
                    {["pending", "failed", "expired"].includes(t.state) && connected && t.provider === v.provider.name && (
                      <button
                        className="button secondary-button"
                        disabled={check.busy}
                        onClick={() => check.run(() => client.execute("reconcileTopup", { id: t.id }))}
                      >
                        {w("Check status", "Semak status")}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="core-two-columns">
        <section className="core-panel">
          <h2>{w("Wallet activity", "Aktiviti dompet")}</h2>
          {!ledger.data ? (
            <Loading error={ledger.error} />
          ) : !ledger.data.items.length ? (
            <p className="core-empty">{w("No activity yet.", "Belum ada aktiviti.")}</p>
          ) : (
            <ul className="core-billing-list">
              {ledger.data.items.map((e) => (
                <li key={e.id}>
                  <span>
                    <strong>{pick(kindText[e.kind], e.kind)}</strong>
                    <small>{e.reason ?? when(e.created_at, ms)}</small>
                  </span>
                  <span data-sign={e.amount_sen < 0 ? "debit" : "credit"}>
                    {e.amount_sen > 0 ? "+" : ""}
                    {formatSen(e.amount_sen)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="core-panel">
          <h2>{w("Usage", "Penggunaan")}</h2>
          {!usage.data ? (
            <Loading error={usage.error} />
          ) : !usage.data.items.length ? (
            <p className="core-empty">
              {w("Calls and messages will appear here once channels are connected.", "Panggilan dan mesej akan dipaparkan di sini selepas saluran disambungkan.")}
            </p>
          ) : (
            <ul className="core-billing-list">
              {usage.data.items.map((u) => (
                <li key={u.id}>
                  <span>
                    <strong>{pick(usageText[u.kind], u.kind)}</strong>
                    <small>
                      {u.kind === "voice_second"
                        ? w(`${Math.floor(u.quantity / 60)} min ${u.quantity % 60} s`, `${Math.floor(u.quantity / 60)} min ${u.quantity % 60} s`)
                        : `× ${u.quantity}`}{" "}
                      · {when(u.occurred_at, ms)}
                    </small>
                  </span>
                  <span>{formatSen(-u.amount_sen)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="core-panel">
        <h2>{w("Receipts", "Resit")}</h2>
        <p className="core-voice-note">
          {w(
            "Payment receipts, not tax invoices. No service tax is charged.",
            "Resit bayaran, bukan invois cukai. Tiada cukai perkhidmatan dikenakan.",
          )}
        </p>
        {!receipts.data ? (
          <Loading error={receipts.error} />
        ) : !receipts.data.items.length ? (
          <p className="core-empty">{w("No receipts yet.", "Belum ada resit.")}</p>
        ) : (
          <ul className="core-billing-list">
            {receipts.data.items.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.number}</strong>
                  <small>
                    {r.buyer_name} · {when(r.issued_at, ms)}
                  </small>
                </span>
                <span>
                  {formatSen(r.amount_sen)}
                  <button
                    className="button secondary-button"
                    onClick={() => {
                      const text = [
                        "JomCall",
                        `${w("Receipt", "Resit")} ${r.number}`,
                        `${w("Issued", "Dikeluarkan")}: ${when(r.issued_at, ms)} (Asia/Kuala_Lumpur)`,
                        `${w("Received from", "Diterima daripada")}: ${r.buyer_name}`,
                        `${w("Credit top-up", "Tambah nilai kredit")}: ${formatSen(r.amount_sen)}`,
                        `${w("Service tax", "Cukai perkhidmatan")}: ${formatSen(r.tax_sen)}`,
                        `${w("Paid through", "Dibayar melalui")}: ${r.provider} ${r.provider_ref}`,
                        w("This is a payment receipt, not a tax invoice.", "Ini resit bayaran, bukan invois cukai."),
                      ].join("\n");
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
                      a.download = r.number + ".txt";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    {w("Download", "Muat turun")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
