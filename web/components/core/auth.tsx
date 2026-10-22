"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { HttpCoreClient } from "@/lib/core/client";
import { PublicFrame } from "../public-pages";
import { useExperience } from "../experience";
import { Field } from "./field";
import { Notice, useWords } from "./state";
export function LocalAuth({
  mode,
}: {
  mode: "login" | "signup" | "forgot" | "invite";
}) {
  const w = useWords(),
    { href } = useExperience(),
    params = useSearchParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [done, setDone] = useState(false);
  const reset = mode === "forgot" && params.get("reset") === "1";
  const token = params.get("token") ?? "";
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
              "Local development · email stays on this computer",
              "Pembangunan setempat · e-mel kekal di komputer ini",
            )}
          </small>
        </section>
        <section className="access-form">
          <span className="remaining-chip">
            {w("Local workspace", "Ruang kerja setempat")}
          </span>
          <h2>{title}</h2>
          <Notice error={error} />
          {done ? (
            <div className="access-success" role="status">
              <h3>
                {reset
                  ? w(
                      "Password updated. Sign in again.",
                      "Kata laluan dikemas kini. Log masuk semula.",
                    )
                  : w(
                      "Check your local mailbox.",
                      "Semak peti mel setempat anda.",
                    )}
              </h3>
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
              <a href={href("/login")}>{w("Sign in", "Log masuk")}</a>
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
                    },
                  );
                  if (mode === "login") location.assign(href("/app"));
                  else setDone(true);
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                {mode === "invite" ? (
                  <>
                    <p>
                      {w(
                        "Sign in with the invited email first, then return to this invitation.",
                        "Log masuk dengan e-mel jemputan dahulu, kemudian kembali ke jemputan ini.",
                      )}
                    </p>
                    <a href={href("/login")}>{w("Sign in", "Log masuk")}</a>
                    <a href={href("/signup")}>
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
                        hint={w(
                          "At least 8 characters",
                          "Sekurang-kurangnya 8 aksara",
                        )}
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
                <button
                  className="button button-dark"
                  disabled={busy || (mode === "invite" && !token)}
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
              </fieldset>
            </form>
          )}
          <div className="core-actions">
            <a href={href(mode === "signup" ? "/login" : "/signup")}>
              {mode === "signup"
                ? w("Already have an account?", "Sudah mempunyai akaun?")
                : w("Create account", "Cipta akaun")}
            </a>
            <a href={href("/forgot-password")}>
              {w("Forgot password?", "Lupa kata laluan?")}
            </a>
          </div>
        </section>
      </main>
    </PublicFrame>
  );
}
