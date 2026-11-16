"use client";
import { HOSTED } from "@/lib/hosted";
// WhatsApp channel settings for the local app. The access token is
// write-only: it is sent once and never shown again. Until the server's
// switch and secrets are set, the screen says the channel is not connected
// and offers nothing that could reach Meta.
import { useState } from "react";
import {
  mappedProviderStatuses,
  providerStatusMap,
  providerStatusNotFound,
  type WhatsAppOverview,
  type WhatsAppTemplate,
} from "../../../packages/contracts/src/whatsapp";
import { syncLine, templateNote } from "@/lib/core/whatsapp-template-rules";
import { useExperience } from "../experience";
import {
  useCore,
  useWords,
  useResource,
  useAction,
  Heading,
  Notice,
  Loading,
} from "./state";
import { Field } from "./field";

const stateWords: Record<string, [string, string]> = {
  not_connected: ["Not connected", "Belum disambungkan"],
  pending: ["Checking the number", "Sedang menyemak nombor"],
  connected: ["Connected", "Disambungkan"],
  failed: ["Check failed", "Semakan gagal"],
  disabled: ["Disconnected", "Diputuskan"],
};
const templateWords: Record<string, [string, string]> = {
  draft: ["Draft", "Draf"],
  pending: ["Waiting for Meta", "Menunggu Meta"],
  approved: ["Approved", "Diluluskan"],
  rejected: ["Rejected", "Ditolak"],
  paused: ["Paused", "Dijeda"],
  disabled: ["Disabled", "Dinyahaktifkan"],
};

// A time in Kuala Lumpur, in the screen's language.
function useKlTime() {
  const { locale } = useExperience();
  return (iso: string) =>
    new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
}

const mapped = new Set<string>(mappedProviderStatuses);

export function LocalWhatsApp() {
  const w = useWords(),
    { client } = useCore();
  const overview = useResource(
    () => client.execute("whatsappOverview", {}),
    "whatsapp",
  );
  return (
    <>
      <Heading
        title={w("WhatsApp, answered.", "WhatsApp, dijawab.")}
        description={w(
          "Connect your WhatsApp Business number so the agent can reply to customers. Staff can take over any chat.",
          "Sambungkan nombor WhatsApp Business anda supaya ejen boleh membalas pelanggan. Staf boleh mengambil alih mana-mana perbualan.",
        )}
      />
      {overview.error ? (
        <Notice error={overview.error} />
      ) : !overview.data ? (
        <Loading />
      ) : (
        <WhatsAppBody
          data={overview.data}
          reload={() => void overview.reload()}
        />
      )}
    </>
  );
}

function WhatsAppBody({
  data,
  reload,
}: {
  data: WhatsAppOverview;
  reload: () => void;
}) {
  const w = useWords();
  const { readiness, channel } = data;
  const state = channel?.state ?? "not_connected";
  const label = stateWords[state] ?? stateWords.not_connected;
  return (
    <>
      <section className="core-panel">
        <span className="remaining-chip">{w(label[0], label[1])}</span>
        {!readiness.configured ? (
          <>
            <h2>
              {w(
                HOSTED
                  ? "WhatsApp is not available yet."
                  : "WhatsApp is not connected on this server.",
                HOSTED
                  ? "WhatsApp belum tersedia."
                  : "WhatsApp belum disambungkan pada pelayan ini.",
              )}
            </h2>
            <p>
              {w(
                HOSTED
                  ? "We are still setting up WhatsApp for JomCall. You will be able to connect your own number here. Nothing is sent to Meta until then."
                  : "The server administrator must turn the channel on and add its secrets first. Nothing is sent to Meta until then.",
                HOSTED
                  ? "Kami masih menyediakan WhatsApp untuk JomCall. Anda akan dapat menyambungkan nombor anda sendiri di sini. Tiada apa-apa dihantar kepada Meta sehingga itu."
                  : "Pentadbir pelayan perlu menghidupkan saluran ini dan menambah rahsianya dahulu. Tiada apa-apa dihantar kepada Meta sehingga itu.",
              )}
            </p>
            {!HOSTED && readiness.missing.length > 0 && (
              <p className="editor-note">
                {w("Missing settings: ", "Tetapan yang tiada: ")}
                {readiness.missing.map((m) => (
                  <code key={m}>{m} </code>
                ))}
              </p>
            )}
          </>
        ) : (
          <>
            {readiness.provider === "fake" && (
              <p className="editor-note">
                {w(
                  HOSTED
                    ? "Practice mode: messages go to a stand-in, not to WhatsApp."
                    : "Practice mode: messages go to a stand-in on this computer, not to WhatsApp. Use npm run whatsapp:simulate to send a test message.",
                  HOSTED
                    ? "Mod latihan: mesej dihantar kepada pengganti, bukan kepada WhatsApp."
                    : "Mod latihan: mesej dihantar kepada pengganti pada komputer ini, bukan kepada WhatsApp. Guna npm run whatsapp:simulate untuk menghantar mesej ujian.",
                )}
              </p>
            )}
            {channel?.display_phone_e164 && (
              <p>
                {w("Number: ", "Nombor: ")}
                <strong>{channel.display_phone_e164}</strong>
              </p>
            )}
            {channel?.state_reason && (
              <p className="storage-warning">{channel.state_reason}</p>
            )}
          </>
        )}
      </section>
      {readiness.configured && <ChannelForm data={data} reload={reload} />}
      {channel && (
        <Templates
          templates={data.templates}
          syncedAt={channel.templates_synced_at}
          syncReason={channel.templates_sync_reason}
          connected={channel.state === "connected"}
          reload={reload}
        />
      )}
      <section className="core-panel">
        <h2>{w("What customers see", "Apa yang pelanggan nampak")}</h2>
        <ul>
          <li>
            {w(
              "The first reply in each conversation says an AI assistant is answering and how to reach staff.",
              "Balasan pertama dalam setiap perbualan menyatakan pembantu AI sedang menjawab dan cara menghubungi staf.",
            )}
          </li>
          <li>
            {w(
              "Typing STOP or BERHENTI records an opt-out on the contact. Nothing else is sent after the confirmation.",
              "Menaip STOP atau BERHENTI merekodkan penolakan pada kenalan. Tiada mesej lain dihantar selepas pengesahan.",
            )}
          </li>
          <li>
            {w(
              "Typing STAF or HUMAN hands the chat to your team and pauses the agent.",
              "Menaip STAF atau MANUSIA menyerahkan perbualan kepada pasukan anda dan menjeda ejen.",
            )}
          </li>
          <li>
            {w(
              "Contacts marked do-not-contact never receive a message. Templates need a recorded consent.",
              "Kenalan bertanda jangan-hubungi tidak akan menerima mesej. Templat memerlukan persetujuan yang direkodkan.",
            )}
          </li>
        </ul>
      </section>
    </>
  );
}

function ChannelForm({
  data,
  reload,
}: {
  data: WhatsAppOverview;
  reload: () => void;
}) {
  const w = useWords(),
    { client } = useCore(),
    action = useAction();
  const channel = data.channel;
  const [phoneNumberId, setPhone] = useState(channel?.phone_number_id ?? ""),
    [wabaId, setWaba] = useState(channel?.waba_id ?? ""),
    [token, setToken] = useState(""),
    [agentEnabled, setAgent] = useState(channel?.agent_enabled ?? true);
  const needsToken = data.readiness.provider === "cloud";
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const done = await action.run(() =>
      client.execute("saveWhatsAppChannel", {
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim(),
        agentEnabled,
        ...(token ? { accessToken: token } : {}),
        ...(channel ? { expectedRevision: channel.revision } : {}),
      }),
    );
    if (done) {
      setToken("");
      reload();
    }
  };
  const disconnect = async () => {
    if (!channel) return;
    if (
      await action.run(() =>
        client.execute("disconnectWhatsApp", {
          expectedRevision: channel.revision,
        }),
      )
    )
      reload();
  };
  return (
    <form className="core-panel core-form" onSubmit={save}>
      <h2>{w("Business number", "Nombor perniagaan")}</h2>
      <div className="core-two-columns">
        <Field
          label={w("Phone number ID", "ID nombor telefon")}
          hint={w(
            "From WhatsApp Manager. Digits only.",
            "Daripada WhatsApp Manager. Digit sahaja.",
          )}
        >
          <input
            inputMode="numeric"
            required
            pattern="[0-9]{5,30}"
            value={phoneNumberId}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field
          label={w("Business account ID", "ID akaun perniagaan")}
          hint={w(
            "WhatsApp Business Account ID.",
            "ID Akaun WhatsApp Business.",
          )}
        >
          <input
            inputMode="numeric"
            required
            pattern="[0-9]{5,30}"
            value={wabaId}
            onChange={(e) => setWaba(e.target.value)}
          />
        </Field>
      </div>
      {needsToken && (
        <Field
          label={w("Access token", "Token akses")}
          hint={
            channel?.credentials_set_at
              ? w(
                  "A token is saved. Leave blank to keep it.",
                  "Token telah disimpan. Biarkan kosong untuk mengekalkannya.",
                )
              : w(
                  "Stored encrypted and never shown again.",
                  "Disimpan secara tersulit dan tidak dipaparkan lagi.",
                )
          }
        >
          <input
            type="password"
            autoComplete="off"
            required={!channel?.credentials_set_at}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </Field>
      )}
      <label>
        <input
          type="checkbox"
          checked={agentEnabled}
          onChange={(e) => setAgent(e.target.checked)}
        />{" "}
        {w(
          "Let the agent reply automatically",
          "Benarkan ejen membalas secara automatik",
        )}
      </label>
      <Notice error={action.error} saved={action.saved} />
      <div className="core-actions">
        <button className="button button-dark" disabled={action.busy}>
          {channel
            ? w("Save and check again", "Simpan dan semak semula")
            : w("Connect number", "Sambungkan nombor")}
        </button>
        {channel && channel.state !== "disabled" && (
          <button
            type="button"
            className="button secondary-button"
            disabled={action.busy}
            onClick={disconnect}
          >
            {w("Disconnect", "Putuskan sambungan")}
          </button>
        )}
      </div>
    </form>
  );
}

function Templates({
  templates,
  syncedAt,
  syncReason,
  connected,
  reload,
}: {
  templates: WhatsAppTemplate[];
  syncedAt: string | null;
  syncReason: string | null;
  connected: boolean;
  reload: () => void;
}) {
  const w = useWords(),
    { client } = useCore(),
    action = useAction(),
    time = useKlTime();
  const [name, setName] = useState("jomcall_reply_request"),
    [language, setLanguage] = useState("ms"),
    [body, setBody] = useState(
      "Kami ada balasan untuk pertanyaan anda. Sila balas mesej ini untuk menyambung perbualan.",
    );
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      await action.run(() =>
        client.execute("createWhatsAppTemplate", {
          name,
          language,
          category: "utility",
          purpose: "reengage",
          body,
          variables: 0,
        }),
      )
    )
      reload();
  };
  // The template whose "Switch off" is waiting for a yes.
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const mark = async (
    t: WhatsAppTemplate,
    status: "pending" | "approved" | "rejected" | "disabled",
  ) => {
    setConfirmOff(null);
    if (
      await action.run(() =>
        client.execute("updateWhatsAppTemplate", {
          id: t.id,
          status,
          expectedRevision: t.revision,
        }),
      )
    )
      reload();
  };
  // Disabled without staff having done it, with a WhatsApp status the map
  // does not know: switching on restores it by hand.
  const stuckOff = (t: WhatsAppTemplate) =>
    t.status === "disabled" &&
    !t.disabled_by_staff &&
    t.provider_status !== null &&
    (t.provider_status === providerStatusNotFound ||
      !(t.provider_status in providerStatusMap));
  const now = new Date();
  const line = syncLine(syncedAt, syncReason, connected, now);
  return (
    <section className="core-panel">
      <h2>{w("Message templates", "Templat mesej")}</h2>
      <p>
        {w(
          "After 24 hours without a customer message, WhatsApp only allows approved templates. Submit each template in WhatsApp Manager and add it here. While the number is connected, JomCall checks each template's status with WhatsApp about once an hour; record Meta's decision by hand only for a template WhatsApp has not listed.",
          "Selepas 24 jam tanpa mesej daripada pelanggan, WhatsApp hanya membenarkan templat yang diluluskan. Hantar setiap templat dalam WhatsApp Manager dan tambahkannya di sini. Semasa nombor disambungkan, JomCall menyemak status setiap templat dengan WhatsApp lebih kurang sejam sekali; rekodkan keputusan Meta secara manual hanya untuk templat yang belum disenaraikan oleh WhatsApp.",
        )}
      </p>
      {line === "checking" && (
        <p className="editor-note" role="status">
          {w(
            "Checking with WhatsApp…",
            "Sedang menyemak dengan WhatsApp…",
          )}
        </p>
      )}
      {line === "failed" && (
        <p className="storage-warning" role="status">
          {w(
            "Could not check with WhatsApp. Statuses below may be out of date.",
            "Tidak dapat menyemak dengan WhatsApp. Status di bawah mungkin sudah lapuk.",
          )}
        </p>
      )}
      {line === "checked" && syncedAt && (
        <p className="editor-note">
          {w(
            `Checked with WhatsApp ${time(syncedAt)}`,
            `Disemak dengan WhatsApp ${time(syncedAt)}`,
          )}
        </p>
      )}
      {!templates.length ? (
        <p className="core-empty">
          {w("No templates yet.", "Belum ada templat.")}
        </p>
      ) : (
        templates.map((t) => {
          const s = templateWords[t.status] ?? [t.status, t.status];
          // Seen at the provider: its status is the truth, so staff do not
          // record one by hand.
          const synced = t.provider_status !== null;
          const note = templateNote(t, syncedAt, syncReason, connected, now);
          return (
            <div className="core-record" key={t.id}>
              <div>
                <strong>{t.name}</strong> <code>{t.language}</code>{" "}
                <span className="remaining-chip">{w(s[0], s[1])}</span>
                <p>{t.body}</p>
                {t.disabled_by_staff && (
                  <p className="editor-note">
                    {w(
                      "Switched off by your team",
                      "Dimatikan oleh pasukan anda",
                    )}
                  </p>
                )}
                {note === "not_found" && (
                  <p className="editor-note">
                    {w(
                      "Not in WhatsApp's list at the last check. If it was deleted there, switch it off here.",
                      "Tiada dalam senarai WhatsApp pada semakan terakhir. Jika ia telah dipadam di sana, matikan di sini.",
                    )}
                  </p>
                )}
                {note === "not_listed" && (
                  <p className="editor-note">
                    {w(
                      "Not listed by WhatsApp. Check the name and language match exactly.",
                      "Tidak disenaraikan oleh WhatsApp. Pastikan nama dan bahasa sepadan dengan tepat.",
                    )}
                  </p>
                )}
                {note === "from_provider" && (
                  <p className="editor-note">
                    {t.synced_at
                      ? w(
                          `Status from WhatsApp, checked ${time(t.synced_at)}`,
                          `Status daripada WhatsApp, disemak ${time(t.synced_at)}`,
                        )
                      : w("Status from WhatsApp", "Status daripada WhatsApp")}
                    {!mapped.has(t.provider_status!) && (
                      <>
                        {" · "}
                        {w(
                          `WhatsApp says: ${t.provider_status}`,
                          `WhatsApp menyatakan: ${t.provider_status}`,
                        )}
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="core-actions">
                {t.disabled_by_staff || stuckOff(t) ? (
                  <button
                    className="button secondary-button"
                    disabled={action.busy}
                    onClick={() => mark(t, "pending")}
                  >
                    {w("Switch on", "Hidupkan")}
                  </button>
                ) : confirmOff === t.id ? (
                  <>
                    <p role="status">
                      {w(
                        "Switch this template off? JomCall will not use it to message customers.",
                        "Matikan templat ini? JomCall tidak akan menggunakannya untuk menghantar mesej kepada pelanggan.",
                      )}
                    </p>
                    <button
                      className="button button-dark"
                      disabled={action.busy}
                      onClick={() => mark(t, "disabled")}
                    >
                      {w("Switch off", "Matikan")}
                    </button>
                    <button
                      className="button secondary-button"
                      onClick={() => setConfirmOff(null)}
                    >
                      {w("Cancel", "Batal")}
                    </button>
                  </>
                ) : (
                  <button
                    className="button secondary-button"
                    disabled={action.busy}
                    onClick={() => setConfirmOff(t.id)}
                  >
                    {w("Switch off", "Matikan")}
                  </button>
                )}
                {!t.disabled_by_staff && !synced && t.status === "draft" && (
                  <button
                    className="button secondary-button"
                    disabled={action.busy}
                    onClick={() => mark(t, "pending")}
                  >
                    {w("Submitted to Meta", "Dihantar kepada Meta")}
                  </button>
                )}
                {!t.disabled_by_staff && !synced && t.status === "pending" && (
                  <>
                    <button
                      className="button secondary-button"
                      disabled={action.busy}
                      onClick={() => mark(t, "approved")}
                    >
                      {w("Mark approved", "Tanda diluluskan")}
                    </button>
                    <button
                      className="button secondary-button"
                      disabled={action.busy}
                      onClick={() => mark(t, "rejected")}
                    >
                      {w("Mark rejected", "Tanda ditolak")}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
      <form className="core-form" onSubmit={add}>
        <h3>
          {w(
            "Add the reply-request template",
            "Tambah templat permintaan balasan",
          )}
        </h3>
        <div className="core-two-columns">
          <Field label={w("Name", "Nama")}>
            <input
              required
              pattern="[a-z0-9_]{1,512}"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={w("Language", "Bahasa")}>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="ms">Bahasa Melayu</option>
              <option value="en">English</option>
              <option value="zh_CN">中文</option>
            </select>
          </Field>
        </div>
        <Field
          label={w("Text", "Teks")}
          hint={w(
            "Must match the text approved by Meta exactly.",
            "Mesti sama tepat dengan teks yang diluluskan oleh Meta.",
          )}
        >
          <textarea
            required
            maxLength={1024}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <Notice error={action.error} saved={action.saved} />
        <div className="core-actions">
          <button className="button button-dark" disabled={action.busy}>
            {w("Add template", "Tambah templat")}
          </button>
        </div>
      </form>
    </section>
  );
}
