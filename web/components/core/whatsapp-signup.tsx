"use client";
// "Connect WhatsApp": Meta's Embedded Signup popup. Meta's script is loaded
// only when the owner presses the button, never when the page opens. The
// popup returns the phone number ID, the business account ID and a one-time
// code; JomCall's server keeps the code sealed and the agent process swaps
// it for the business's token. Nothing on this screen ever holds a token.
import { useEffect, useRef, useState } from "react";
import {
  metaGraphVersion,
  type WhatsAppOverview,
} from "../../../packages/contracts/src/whatsapp";
import {
  readSignupMessage,
  signupLoginOptions,
  type SignupSession,
} from "@/lib/core/whatsapp-signup";
import { useAction, useCore, useWords, Notice } from "./state";

type Fb = {
  init(options: Record<string, unknown>): void;
  login(
    done: (response: { authResponse?: { code?: string } | null }) => void,
    options: Record<string, unknown>,
  ): void;
};
declare global {
  interface Window {
    FB?: Fb;
    fbAsyncInit?: () => void;
  }
}

const sdkUrl = "https://connect.facebook.net/en_US/sdk.js";
let sdk: Promise<Fb> | undefined;
function loadSdk(appId: string): Promise<Fb> {
  sdk ??= new Promise<Fb>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({
        appId,
        autoLogAppEvents: false,
        xfbml: false,
        version: metaGraphVersion,
      });
      resolve(window.FB!);
    };
    const script = document.createElement("script");
    script.src = sdkUrl;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdk = undefined;
      reject(new Error("SDK_UNAVAILABLE"));
    };
    document.head.appendChild(script);
  });
  return sdk;
}

type Problem = "sdk" | "cancelled" | "meta" | null;

export function WhatsAppSignup({
  data,
  reload,
}: {
  data: WhatsAppOverview;
  reload: () => void;
}) {
  const w = useWords(),
    { client } = useCore(),
    action = useAction();
  const settings = data.readiness.signup!;
  const channel = data.channel;
  const [opening, setOpening] = useState(false),
    [problem, setProblem] = useState<Problem>(null);
  // The popup answers twice, in either order: a window message with the
  // IDs and the login callback with the code. Both are needed.
  const session = useRef<SignupSession>(null);
  const code = useRef<string | null>(null);
  const revision = useRef(channel?.revision);
  revision.current = channel?.revision;
  const sent = useRef(false);

  const finish = async () => {
    const s = session.current;
    if (sent.current || !code.current || s?.kind !== "finish") return;
    sent.current = true;
    const done = await action.run(() =>
      client.execute("connectWhatsAppSignup", {
        phoneNumberId: s.phoneNumberId,
        wabaId: s.wabaId,
        code: code.current!,
        ...(s.coexistence ? { coexistence: true } : {}),
        agentEnabled: channel?.agent_enabled ?? true,
        ...(revision.current ? { expectedRevision: revision.current } : {}),
      }),
    );
    code.current = null;
    session.current = null;
    setOpening(false);
    if (done) reload();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const read = readSignupMessage(e.origin, e.data);
      if (!read) return;
      session.current = read;
      if (read.kind === "finish") void finishRef.current();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // While the agent process finishes the connection, look again every two
  // seconds; it usually takes a few.
  const pending = channel?.state === "pending";
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [pending, reload]);

  const open = async () => {
    setProblem(null);
    setOpening(true);
    sent.current = false;
    session.current = null;
    code.current = null;
    let fb: Fb;
    try {
      fb = await loadSdk(settings.appId);
    } catch {
      setOpening(false);
      setProblem("sdk");
      return;
    }
    fb.login((response) => {
      const value = response.authResponse?.code;
      if (typeof value === "string" && value) {
        code.current = value;
        // The window message may still be on its way.
        void finishRef.current();
        setTimeout(() => {
          if (!sent.current) {
            setOpening(false);
            setProblem("meta");
          }
        }, 4000);
      } else {
        setOpening(false);
        setProblem(session.current?.kind === "error" ? "meta" : "cancelled");
      }
    }, signupLoginOptions(settings));
  };

  const connected = channel?.state === "connected";
  return (
    <section className="core-panel core-form" aria-labelledby="wa-signup">
      <h2 id="wa-signup">
        {connected
          ? w("Connected through Facebook", "Disambungkan melalui Facebook")
          : w(
              "Connect your WhatsApp number",
              "Sambungkan nombor WhatsApp anda",
            )}
      </h2>
      {pending ? (
        <p className="editor-note" role="status">
          {w(
            "Finishing the connection. This takes a few seconds…",
            "Sedang melengkapkan sambungan. Ini mengambil beberapa saat…",
          )}
        </p>
      ) : (
        <>
          <p>
            {connected
              ? w(
                  "To use a different number or sign in again, connect once more.",
                  "Untuk menggunakan nombor lain atau log masuk semula, sambungkan sekali lagi.",
                )
              : w(
                  "Log in to Facebook, choose your business and your WhatsApp number, and press Finish. JomCall does the rest.",
                  "Log masuk ke Facebook, pilih perniagaan dan nombor WhatsApp anda, dan tekan Finish. JomCall uruskan selebihnya.",
                )}
          </p>
          <ul className="core-steps">
            <li>
              {w(
                "You need a Facebook account that manages your business.",
                "Anda perlukan akaun Facebook yang mengurus perniagaan anda.",
              )}
            </li>
            <li>
              {settings.coexistence
                ? w(
                    "You can keep using the WhatsApp Business app on the same number.",
                    "Anda boleh terus menggunakan aplikasi WhatsApp Business pada nombor yang sama.",
                  )
                : w(
                    "Use a number that is not in the WhatsApp or WhatsApp Business app, or remove it from the app first.",
                    "Guna nombor yang tiada dalam aplikasi WhatsApp atau WhatsApp Business, atau buang daripada aplikasi dahulu.",
                  )}
            </li>
            <li>
              {w(
                "Meta bills your business for WhatsApp messages. After connecting, add a payment method in WhatsApp Manager.",
                "Meta mengebil perniagaan anda untuk mesej WhatsApp. Selepas menyambung, tambah kaedah pembayaran dalam WhatsApp Manager.",
              )}
            </li>
          </ul>
          <Notice error={action.error} />
          {problem && (
            <p className="storage-warning" role="alert">
              {problem === "sdk"
                ? w(
                    "Facebook's sign-in could not be loaded. Check your connection or ad blocker and try again.",
                    "Log masuk Facebook tidak dapat dimuatkan. Semak sambungan atau penyekat iklan anda dan cuba lagi.",
                  )
                : problem === "cancelled"
                  ? w(
                      "The Facebook window was closed before finishing. Nothing was changed.",
                      "Tetingkap Facebook ditutup sebelum selesai. Tiada apa-apa diubah.",
                    )
                  : w(
                      "Facebook did not return your number. Try again.",
                      "Facebook tidak memulangkan nombor anda. Cuba lagi.",
                    )}
            </p>
          )}
          <button
            type="button"
            className={
              connected ? "button secondary-button" : "button button-dark"
            }
            disabled={opening || action.busy}
            onClick={() => void open()}
          >
            {opening || action.busy
              ? w("Waiting for Facebook…", "Menunggu Facebook…")
              : connected
                ? w("Connect again", "Sambung semula")
                : w("Connect WhatsApp", "Sambungkan WhatsApp")}
          </button>
          <p className="core-hint">
            {w(
              "Pressing the button loads Facebook's sign-in on this page and opens a Facebook window.",
              "Menekan butang ini memuatkan log masuk Facebook pada halaman ini dan membuka tetingkap Facebook.",
            )}
          </p>
        </>
      )}
    </section>
  );
}
