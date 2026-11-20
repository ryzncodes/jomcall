"use client";
import { HOSTED } from "@/lib/hosted";
// WhatsApp channel settings for the local app. The access token is
// write-only: it is sent once and never shown again. Until the server's
// switch and secrets are set, the screen says the channel is not connected
// and offers nothing that could reach Meta.
import { useEffect, useRef, useState } from "react";
import {
  mappedProviderStatuses,
  providerStatusMap,
  providerStatusNotFound,
  type WhatsAppOverview,
  type WhatsAppTemplate,
} from "../../../packages/contracts/src/whatsapp";
import { syncLine, templateNote } from "@/lib/core/whatsapp-template-rules";
import { useExperience } from "../experience";
import { WhatsAppSignup } from "./whatsapp-signup";
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
import { PRIVACY_CONTACT_EMAIL } from "@/lib/operator";
import { WHATSAPP_WAITING_FOR_META, whatsappWaiting } from "@/lib/launch";

// Why a number check failed, in words. Codes with no entry are shown as the
// code itself, so nothing is hidden.
function reasonText(
  reason: string,
  w: (en: string, ms: string) => string,
): string {
  switch (reason) {
    case "META_190":
      return w(
        "WhatsApp rejected the access token. It has expired or been revoked. Save a new token (a token from a system user does not expire quickly) and check again.",
        "WhatsApp menolak token akses. Ia sudah tamat tempoh atau dibatalkan. Simpan token baharu (token daripada pengguna sistem tidak cepat tamat) dan semak semula.",
      );
    case "SUBSCRIBE_FAILED":
      return w(
        "JomCall could not register to receive this WhatsApp account's messages. In Meta Business settings, check that the system user has both the WhatsApp account and the messaging account (business account) assigned, and that the Business account ID here is right. Then save again.",
        "JomCall tidak dapat mendaftar untuk menerima mesej daripada akaun WhatsApp ini. Dalam tetapan Meta Business, pastikan pengguna sistem diberi akses kepada akaun WhatsApp dan juga akaun pemesejan (akaun perniagaan), dan ID akaun perniagaan di sini betul. Kemudian simpan semula.",
      );
    case "SIGNUP_CODE_REJECTED":
    case "SIGNUP_TOKEN_MISSING":
      return w(
        "Facebook's sign-in ran out of time or was refused. Press Connect WhatsApp and finish it again.",
        "Log masuk Facebook tamat masa atau ditolak. Tekan Sambungkan WhatsApp dan lengkapkan sekali lagi.",
      );
    case "SIGNUP_NOT_CONFIGURED":
      return w(
        "JomCall is not set up to finish Facebook's sign-in yet. Tell the JomCall team.",
        "JomCall belum disediakan untuk melengkapkan log masuk Facebook. Maklumkan pasukan JomCall.",
      );
    case "REGISTER_FAILED":
      return w(
        "the number could not be registered for JomCall. If it was connected to another service before, set a new two-step PIN in WhatsApp Manager, then press Connect again.",
        "nombor ini tidak dapat didaftarkan untuk JomCall. Jika ia pernah disambungkan ke perkhidmatan lain, tetapkan PIN dua langkah baharu dalam WhatsApp Manager, kemudian tekan Sambung semula.",
      );
    case "INVALID_TARGET":
      return w(
        "The phone number ID, business account ID or token is missing or not in the right form.",
        "ID nombor telefon, ID akaun perniagaan atau token tiada atau formatnya tidak betul.",
      );
    case "PROVIDER_UNREACHABLE":
      return w(
        "JomCall could not reach WhatsApp. Check again in a moment.",
        "JomCall tidak dapat menghubungi WhatsApp. Semak semula sebentar lagi.",
      );
    default:
      return reason;
  }
}

// Why WhatsApp did not take a template, in words staff can act on.
function submitFailedText(
  reason: string | null,
  w: (en: string, ms: string) => string,
): string {
  switch (reason) {
    case "TEMPLATE_SUBMIT_STALE":
      return w(
        "The WhatsApp connection changed while this was being sent. Submit it again.",
        "Sambungan WhatsApp berubah semasa templat ini dihantar. Hantar sekali lagi.",
      );
    case "META_190":
    case "WHATSAPP_CREDENTIALS_MISSING":
    case "WHATSAPP_CREDENTIALS_INVALID":
    case "WHATSAPP_CREDENTIALS_KEY_REQUIRED":
      return w(
        "WhatsApp rejected the saved access. Connect the number again, then submit the template once more.",
        "WhatsApp menolak akses yang disimpan. Sambungkan nombor sekali lagi, kemudian hantar templat semula.",
      );
    case "PROVIDER_UNREACHABLE":
      return w(
        "JomCall could not reach WhatsApp. It may still have been created: wait for the next status check, or try again.",
        "JomCall tidak dapat menghubungi WhatsApp. Templat mungkin sudah dicipta: tunggu semakan status seterusnya, atau cuba lagi.",
      );
    default:
      return w(
        "WhatsApp did not accept this template. A template with this name and language may already exist there, or the text breaks WhatsApp's template rules. Check it in WhatsApp Manager.",
        "WhatsApp tidak menerima templat ini. Templat dengan nama dan bahasa ini mungkin sudah wujud di sana, atau teksnya melanggar peraturan templat WhatsApp. Semak dalam WhatsApp Manager.",
      );
  }
}

// A reason that ends a sentence, so more text can follow it.
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : text + ".");

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
  const time = useKlTime();
  const { readiness, channel } = data;
  const state = channel?.state ?? "not_connected";
  const label = stateWords[state] ?? stateWords.not_connected;
  // Hosted, before Meta's approval: a workspace that is not connected yet
  // is told to wait instead of being offered a button Meta would refuse.
  const waiting =
    HOSTED && WHATSAPP_WAITING_FOR_META && channel?.state !== "connected";
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
              <p className="storage-warning">
                {reasonText(channel.state_reason, w)}
              </p>
            )}
            {channel?.state === "connected" && channel.recheck_wanted && (
              <p className="editor-note" role="status">
                {w(
                  "Connected. Checking the new details…",
                  "Disambungkan. Sedang menyemak butiran baharu…",
                )}
              </p>
            )}
            {channel?.state === "connected" &&
              !channel.recheck_wanted &&
              channel.last_check_failed_reason && (
                <p className="storage-warning" role="alert">
                  {w(
                    "Still connected, but the last check failed: ",
                    "Masih disambungkan, tetapi semakan terakhir gagal: ",
                  )}
                  {sentence(reasonText(channel.last_check_failed_reason, w))}{" "}
                  {channel.last_check_failed_at &&
                    `(${w("Checked ", "Disemak ")}${time(channel.last_check_failed_at)}.) `}
                  {w(
                    "Replies may fail until this is fixed. Save again after fixing it.",
                    "Balasan mungkin gagal sehingga ini dibetulkan. Simpan semula selepas membetulkannya.",
                  )}
                </p>
              )}
          </>
        )}
      </section>
      {waiting && (
        <section className="core-panel" aria-labelledby="wa-waiting">
          <h2 id="wa-waiting">{w(...whatsappWaiting.title)}</h2>
          <p>{w(...whatsappWaiting.body)}</p>
        </section>
      )}
      {!waiting && readiness.configured && readiness.signup && (
        <WhatsAppSignup data={data} reload={reload} />
      )}
      {!waiting &&
        readiness.configured &&
        (readiness.signup ? (
          <details className="core-advanced">
            <summary>
              {w(
                "Advanced: enter the IDs and token yourself",
                "Lanjutan: masukkan ID dan token sendiri",
              )}
            </summary>
            <ChannelForm data={data} reload={reload} />
          </details>
        ) : (
          <ChannelForm data={data} reload={reload} />
        ))}
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
        ...(token.trim() ? { accessToken: token.trim() } : {}),
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
      {!channel && (
        <details className="core-help">
          <summary>
            {w(
              "Where do I find these three values?",
              "Di mana saya dapatkan tiga nilai ini?",
            )}
          </summary>
          <ol className="core-steps">
            <li>
              {w(
                "You need a WhatsApp Business Platform number in your own Meta Business account. A number used in the WhatsApp Business phone app must be moved there first.",
                "Anda perlukan nombor WhatsApp Business Platform dalam akaun Meta Business anda sendiri. Nombor yang digunakan dalam aplikasi telefon WhatsApp Business perlu dipindahkan ke sana dahulu.",
              )}
            </li>
            <li>
              {w(
                "In Meta Business Suite, open WhatsApp Manager, then Phone numbers. The Phone number ID and the WhatsApp Business Account ID are shown there.",
                "Dalam Meta Business Suite, buka WhatsApp Manager, kemudian Phone numbers. Phone number ID dan WhatsApp Business Account ID dipaparkan di situ.",
              )}
            </li>
            <li>
              {w(
                "In Business settings, create a System user, give it your WhatsApp account, and generate a token with the two WhatsApp permissions. Paste that token here.",
                "Dalam Business settings, cipta System user, berikan akaun WhatsApp anda kepadanya, dan jana token dengan dua kebenaran WhatsApp. Tampal token itu di sini.",
              )}
            </li>
          </ol>
          <p className="core-hint">
            {w(
              `Stuck? Email ${PRIVACY_CONTACT_EMAIL} and we will connect it with you.`,
              `Tersekat? E-mel ${PRIVACY_CONTACT_EMAIL} dan kami akan sambungkannya bersama anda.`,
            )}
          </p>
        </details>
      )}
      <div className="core-two-columns">
        <Field
          label={w("Phone number ID", "ID nombor telefon")}
          hint={w(
            "From WhatsApp Manager. Digits only.",
            "Daripada WhatsApp Manager. Digit sahaja.",
          )}
        >
          <input
            name="wa_number_id"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
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
            name="wa_business_id"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
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
          {/* Not type=password: browsers treat that as a login form and
              autofill the owner's own password into it. The value is hidden
              by CSS instead (.secret-input). */}
          <input
            type="text"
            name="wa_access_token"
            className="secret-input"
            data-gramm="false"
            data-enable-grammarly="false"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
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
  const submit = async (t: WhatsAppTemplate) => {
    if (
      await action.run(() =>
        client.execute("submitWhatsAppTemplate", {
          id: t.id,
          expectedRevision: t.revision,
        }),
      )
    )
      reload();
  };
  // Listed by WhatsApp at the last check. One that was listed and is gone
  // (NOT_FOUND) is not, and can be submitted again.
  const atProvider = (t: WhatsAppTemplate) =>
    t.provider_status !== null && t.provider_status !== providerStatusNotFound;
  // A request the agent process can still serve: not switched off and not
  // already at WhatsApp.
  const inFlight = (t: WhatsAppTemplate) =>
    (t.submit_state === "wanted" || t.submit_state === "sending") &&
    !t.disabled_by_staff &&
    !atProvider(t);
  // While the agent process sends a template to WhatsApp, look again every
  // two seconds; it usually takes a few. After a minute and a half the page
  // stops asking and says so, so a stuck request never polls for ever.
  const sending = templates.some(inFlight);
  const [slow, setSlow] = useState(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    setSlow(false);
    if (!sending || !connected) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 90_000) {
        clearInterval(timer);
        setSlow(true);
      } else reloadRef.current();
    }, 2000);
    return () => clearInterval(timer);
  }, [sending, connected]);
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
          "After 24 hours without a customer message, WhatsApp only allows approved templates. Add a template here and press Submit to WhatsApp to send it for Meta's review. While the number is connected, JomCall checks each template's status with WhatsApp about once an hour; record Meta's decision by hand only for a template you created in WhatsApp Manager that WhatsApp has not listed.",
          "Selepas 24 jam tanpa mesej daripada pelanggan, WhatsApp hanya membenarkan templat yang diluluskan. Tambah templat di sini dan tekan Hantar ke WhatsApp untuk semakan Meta. Semasa nombor disambungkan, JomCall menyemak status setiap templat dengan WhatsApp lebih kurang sejam sekali; rekodkan keputusan Meta secara manual hanya untuk templat yang anda cipta dalam WhatsApp Manager dan belum disenaraikan oleh WhatsApp.",
        )}
      </p>
      {line === "checking" && (
        <p className="editor-note" role="status">
          {w("Checking with WhatsApp…", "Sedang menyemak dengan WhatsApp…")}
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
                {inFlight(t) && (
                  <p className="editor-note" role="status">
                    {connected
                      ? slow
                        ? w(
                            "This is taking longer than usual. Reload the page in a few minutes to see the outcome.",
                            "Ini mengambil masa lebih lama daripada biasa. Muat semula halaman dalam beberapa minit untuk melihat hasilnya.",
                          )
                        : w(
                            "Sending to WhatsApp for review…",
                            "Sedang dihantar ke WhatsApp untuk semakan…",
                          )
                      : w(
                          "Waiting to be sent: the number is not connected.",
                          "Menunggu untuk dihantar: nombor belum disambungkan.",
                        )}
                  </p>
                )}
                {!atProvider(t) && t.submit_state === "failed" && (
                  <p className="storage-warning" role="alert">
                    {submitFailedText(t.submit_reason, w)}
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
                {connected &&
                  !t.disabled_by_staff &&
                  !atProvider(t) &&
                  t.submit_state !== "wanted" &&
                  t.submit_state !== "sending" && (
                    <button
                      className="button button-dark"
                      disabled={action.busy}
                      onClick={() => submit(t)}
                    >
                      {t.submit_state === "failed"
                        ? w("Try submitting again", "Cuba hantar lagi")
                        : w("Submit to WhatsApp", "Hantar ke WhatsApp")}
                    </button>
                  )}
                {!t.disabled_by_staff &&
                  !synced &&
                  t.submit_state === null &&
                  t.status === "draft" && (
                    <button
                      className="button secondary-button"
                      disabled={action.busy}
                      onClick={() => mark(t, "pending")}
                    >
                      {w("Submitted to Meta", "Dihantar kepada Meta")}
                    </button>
                  )}
                {!t.disabled_by_staff &&
                  !synced &&
                  t.submit_state === null &&
                  t.status === "pending" && (
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
