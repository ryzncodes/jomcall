"use client";
import { HOSTED } from "@/lib/hosted";
import { launchCopy } from "@/lib/launch";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HttpCoreClient } from "@/lib/core/client";
import { forgetInvite, rememberInvite, validInvite } from "@/lib/core/invite";
import { PublicFrame } from "../public-pages";
import { useExperience } from "../experience";
import { Field } from "./field";
import { Notice, useWords } from "./state";
import { Turnstile, type TurnstileHandle } from "./turnstile";
export function LocalAuth({
  mode,
}: {
  mode: "login" | "signup" | "forgot" | "invite";
}) {
  const w = useWords(),
    { href, mode: appMode, turnstileSiteKey, theme, locale } = useExperience(),
    params = useSearchParams();
  const challenge = useRef<TurnstileHandle>(null),
    [turnstileToken, setTurnstileToken] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [done, setDone] = useState(false);
  const reset = mode === "forgot" && params.get("reset") === "1";
  const token = params.get("token") ?? "";
  // An invitation that sent the person here to sign in or sign up first.
  const invite = validInvite(params.get("invite")) ? params.get("invite")! : "";
  useEffect(() => {
    if (mode === "invite") rememberInvite(token);
  }, [mode, token]);
  // Hosted mode with Turnstile configured, on sign-up and sign-in only.
  const guarded =
    !!turnstileSiteKey && !reset && (mode === "login" || mode === "signup");
  const title = reset
    ? w("Choose a new password", "Pilih kata laluan baharu")
    : mode === "signup"
      ? w("Your workspace starts here.", "Ruang kerja anda bermula di sini.")
      : mode === "forgot"
        ? w("Reset your password.", "Tetapkan semula kata laluan.")
        : mode === "invite"
          ? w("Join your team.", "Sertai pasukan anda.")
          : w("Welcome back.", "Selamat kembali.");
  return (
    <PublicFrame>
      <main id="content" tabIndex={-1} className="access-layout">
        <section className="access-story">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <h1>
            {w(
              "Every relationship. One workspace.",
              "Setiap hubungan. Satu ruang kerja.",
            )}
          </h1>
          <p>
            {w(
              "Build your front desk, keep customer context and give your team a shared place to work.",
              "Bina kaunter hadapan anda, simpan konteks pelanggan dan bekerjasama dalam satu ruang.",
            )}
          </p>
          <div className="access-lines" aria-hidden="true">
            {Array.from({ length: 25 }, (_, i) => (
              <i
                key={i}
                style={{
                  height: `${24 + Math.sin(i * 0.8) * 15 + (i % 4) * 10}%`,
                }}
              />
            ))}
          </div>
          <small>
            {w(
              HOSTED
                ? launchCopy.badge[0]
                : "Local development · email stays on this computer",
              HOSTED
                ? launchCopy.badge[1]
                : "Pembangunan setempat · e-mel kekal di komputer ini",
            )}
          </small>
        </section>
        <section className="access-form">
          {!HOSTED && (
            <span className="remaining-chip">
              {w("Local workspace", "Ruang kerja setempat")}
            </span>
          )}
          <h2>{title}</h2>
          <Notice
            error={error}
            context={mode === "invite" ? "invite" : undefined}
          />
          {done ? (
            <div className="access-success" role="status">
              <h3>
                {reset
                  ? w(
                      "Password updated. Sign in again.",
                      "Kata laluan dikemas kini. Log masuk semula.",
                    )
                  : appMode === "hosted"
                    ? w("Check your email.", "Semak e-mel anda.")
                    : w(
                        "Check your local mailbox.",
                        "Semak peti mel setempat anda.",
                      )}
              </h3>
              {appMode === "hosted" ? (
                <p>
                  {w(
                    "If the address can be used, a message with the next step is on its way.",
                    "Jika alamat ini boleh digunakan, mesej dengan langkah seterusnya sedang dihantar.",
                  )}
                </p>
              ) : (
                <>
                  <p>
                    {w(
                      "Confirmation and recovery messages are captured in Mailpit.",
                      "Mesej pengesahan dan pemulihan disimpan dalam Mailpit.",
                    )}
                  </p>
                  <a
                    className="button secondary-button"
                    href="http://127.0.0.1:54624"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {w("Open local mail", "Buka mel setempat")}
                  </a>
                </>
              )}
              {invite && mode === "signup" && (
                <p>
                  {w(
                    "After you confirm your email, your invitation will be waiting in the app.",
                    "Selepas anda mengesahkan e-mel, jemputan anda menunggu dalam aplikasi.",
                  )}
                </p>
              )}
              <a href={href(invite ? "/login?invite=" + invite : "/login")}>
                {w("Sign in", "Log masuk")}
              </a>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(undefined);
                const f = new FormData(e.currentTarget),
                  client = new HttpCoreClient({});
                try {
                  if (mode === "invite") {
                    const member = await client.execute("acceptInvite", {
                      token,
                    });
                    forgetInvite();
                    location.assign(href("/app?workspace=" + member.org_id));
                    return;
                  }
                  await client.auth(
                    reset
                      ? "reset-password"
                      : mode === "forgot"
                        ? "forgot-password"
                        : mode,
                    {
                      ...(reset ? {} : { email: String(f.get("email")) }),
                      ...(mode === "forgot" && !reset
                        ? {}
                        : { password: String(f.get("password")) }),
                      ...(guarded ? { turnstileToken } : {}),
                    },
                  );
                  if (mode === "login")
                    location.assign(
                      href(invite ? "/invite?token=" + invite : "/app"),
                    );
                  else setDone(true);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                  if (guarded) challenge.current?.reset();
                }
              }}
            >
              <fieldset disabled={busy}>
                {mode === "invite" ? (
                  <>
                    <p>
                      {w(
                        "Signed in with the invited email? Press Accept. If not, sign in or create an account first. Signing in brings you back here.",
                        "Sudah log masuk dengan e-mel jemputan? Tekan Terima. Jika belum, log masuk atau cipta akaun dahulu. Selepas log masuk, anda dibawa kembali ke sini.",
                      )}
                    </p>
                    <a
                      href={href(
                        validInvite(token)
                          ? "/login?invite=" + token
                          : "/login",
                      )}
                    >
                      {w("Sign in", "Log masuk")}
                    </a>
                    <a
                      href={href(
                        validInvite(token)
                          ? "/signup?invite=" + token
                          : "/signup",
                      )}
                    >
                      {w("Create account", "Cipta akaun")}
                    </a>
                  </>
                ) : (
                  <>
                    {!reset && (
                      <Field label={w("Email", "E-mel")}>
                        <input
                          name="email"
                          type="email"
                          autoComplete="email"
                          required
                          maxLength={254}
                        />
                      </Field>
                    )}
                    {(mode !== "forgot" || reset) && (
                      <Field
                        label={w("Password", "Kata laluan")}
                        hint={
                          mode === "login"
                            ? undefined
                            : w(
                                "At least 8 characters",
                                "Sekurang-kurangnya 8 aksara",
                              )
                        }
                      >
                        <input
                          name="password"
                          type="password"
                          autoComplete={
                            mode === "login"
                              ? "current-password"
                              : "new-password"
                          }
                          required
                          minLength={8}
                          maxLength={128}
                        />
                      </Field>
                    )}
                  </>
                )}
                {guarded && (
                  <Turnstile
                    ref={challenge}
                    siteKey={turnstileSiteKey!}
                    action={mode as "login" | "signup"}
                    theme={theme}
                    locale={locale}
                    onToken={setTurnstileToken}
                  />
                )}
                <button
                  className="button button-dark"
                  disabled={
                    busy ||
                    (mode === "invite" && !token) ||
                    (guarded && !turnstileToken)
                  }
                >
                  {busy
                    ? w("Working…", "Memproses…")
                    : mode === "invite"
                      ? w("Accept invitation", "Terima jemputan")
                      : mode === "signup"
                        ? w("Create account", "Cipta akaun")
                        : mode === "forgot"
                          ? w("Reset password", "Tetapkan semula")
                          : w("Sign in", "Log masuk")}
                </button>
                {mode === "signup" && (
                  <p className="access-terms">
                    {w("By creating an account, you agree to the ", "Dengan mencipta akaun, anda bersetuju dengan ")}
                    <a href={href("/terms")}>{w("Terms of use", "Terma penggunaan")}</a>
                    {w(" and the ", " dan ")}
                    <a href={href("/privacy")}>{w("Privacy notice", "Notis privasi")}</a>.
                  </p>
                )}
              </fieldset>
            </form>
          )}
          <div className="core-actions">
            {mode === "forgot" ? (
              <a href={href("/login")}>
                {w("Back to sign in", "Kembali ke log masuk")}
              </a>
            ) : (
              <>
                <a href={href(mode === "signup" ? "/login" : "/signup")}>
                  {mode === "signup"
                    ? w("Already have an account?", "Sudah mempunyai akaun?")
                    : w("Create account", "Cipta akaun")}
                </a>
                <a href={href("/forgot-password")}>
                  {w("Forgot password?", "Lupa kata laluan?")}
                </a>
              </>
            )}
          </div>
        </section>
      </main>
    </PublicFrame>
  );
}

// Where a confirmation or recovery email link lands. The emailed link is
// spent by the button here, never by loading a page: mail scanners and link
// previews open links too, and the token works once.
export function OpenLink() {
  const w = useWords(),
    { href } = useExperience(),
    params = useSearchParams();
  const kind = params.get("kind") === "recovery" ? "recovery" : "confirm";
  const raw = params.get("token_hash") ?? "";
  const token = /^[a-f0-9]{40,128}$/.test(raw) ? raw : "";
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(!token),
    [error, setError] = useState<unknown>();
  const press = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const done = (await new HttpCoreClient({}).auth(kind, {
        tokenHash: token,
      })) as { next?: string };
      location.assign(href(done.next ?? "/app"));
    } catch (e) {
      // A used or expired link is the usual case for an account that is
      // already confirmed, so it gets its own page, not a red error.
      if ((e as { code?: string }).code === "INVALID_LINK") setFailed(true);
      else setError(e);
      setBusy(false);
    }
  };
  return (
    <PublicFrame>
      <main id="content" tabIndex={-1} className="access-layout access-single">
        <section className="access-form">
          {!HOSTED && (
            <span className="remaining-chip">
              {w("Local workspace", "Ruang kerja setempat")}
            </span>
          )}
          {failed ? (
            <div className="access-success" role="status">
              <h2>
                {w(
                  "This link was already used, or it has expired.",
                  "Pautan ini sudah digunakan, atau sudah tamat tempoh.",
                )}
              </h2>
              <p>
                {kind === "confirm"
                  ? w(
                      "If you have confirmed your email before, sign in. If not, create your account again to get a new link.",
                      "Jika anda sudah mengesahkan e-mel sebelum ini, log masuk. Jika belum, cipta akaun sekali lagi untuk mendapat pautan baharu.",
                    )
                  : w(
                      "Ask for a new reset link. Each link works once.",
                      "Minta pautan tetapan semula yang baharu. Setiap pautan berfungsi sekali sahaja.",
                    )}
              </p>
              <a
                className="button button-dark"
                href={href(kind === "confirm" ? "/login" : "/forgot-password")}
              >
                {kind === "confirm"
                  ? w("Sign in", "Log masuk")
                  : w("Get a new link", "Dapatkan pautan baharu")}
              </a>
            </div>
          ) : (
            <>
              <h2>
                {kind === "confirm"
                  ? w("Confirm your email.", "Sahkan e-mel anda.")
                  : w("Reset your password.", "Tetapkan semula kata laluan.")}
              </h2>
              <p>
                {kind === "confirm"
                  ? w(
                      "One more step: press the button to confirm this email address and open your workspace.",
                      "Satu langkah lagi: tekan butang untuk mengesahkan alamat e-mel ini dan membuka ruang kerja anda.",
                    )
                  : w(
                      "Press the button to choose a new password.",
                      "Tekan butang untuk memilih kata laluan baharu.",
                    )}
              </p>
              <Notice error={error} />
              <button className="button button-dark" disabled={busy} onClick={press}>
                {kind === "confirm"
                  ? w("Confirm my account", "Sahkan akaun saya")
                  : w("Choose a new password", "Pilih kata laluan baharu")}
              </button>
            </>
          )}
        </section>
      </main>
    </PublicFrame>
  );
}
