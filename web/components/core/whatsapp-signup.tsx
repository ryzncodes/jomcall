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
  signupCollector,
  signupLoginOptions,
  type SignupProblem,
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

type Problem = "sdk" | SignupProblem | null;

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
  // loading: Meta's script is on its way. ready: it is loaded, and the next
  // press opens the window (a window opened after a wait is blocked by
  // browsers, so loading and opening are two presses). waiting: the window
  // is open.
  const [stage, setStage] = useState<"idle" | "loading" | "ready" | "waiting">(
      "idle",
    ),
    [problem, setProblem] = useState<Problem>(null);
  const latest = useRef({ channel, action, client, reload });
  latest.current = { channel, action, client, reload };
  const collector = useRef<ReturnType<typeof signupCollector>>(null);
  collector.current ??= signupCollector({
    submit: (result) => {
      const now = latest.current;
      void now.action
        .run(() =>
          now.client.execute("connectWhatsAppSignup", {
            phoneNumberId: result.phoneNumberId,
            wabaId: result.wabaId,
            code: result.code,
            ...(result.coexistence ? { coexistence: true } : {}),
            agentEnabled: now.channel?.agent_enabled ?? true,
            ...(now.channel ? { expectedRevision: now.channel.revision } : {}),
          }),
        )
        .then((done) => {
          setStage("ready");
          if (done) latest.current.reload();
        });
    },
    problem: (kind) => {
      setStage("ready");
      setProblem(kind);
    },
  });

  useEffect(() => {
    const onMessage = (e: MessageEvent) =>
      collector.current!.message(readSignupMessage(e.origin, e.data));
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      collector.current!.stop();
    };
  }, []);

  // While the agent process finishes the connection, look again every two
  // seconds; it usually takes a few.
  const finishing = !!channel?.signup_pending || channel?.state === "pending";
  useEffect(() => {
    if (!finishing) return;
    const timer = setInterval(() => latest.current.reload(), 2000);
    return () => clearInterval(timer);
  }, [finishing]);

  const press = async () => {
    setProblem(null);
    if (stage === "idle") {
      setStage("loading");
      try {
        await loadSdk(settings.appId);
        setStage("ready");
      } catch {
        setStage("idle");
        setProblem("sdk");
      }
      return;
    }
    // Opened straight from the press, with nothing awaited before it. A
    // second press while waiting starts over, for a window that was blocked
    // or lost.
    collector.current!.start();
    setStage("waiting");
    window.FB!.login(
      (response) => collector.current!.callback(response.authResponse?.code),
      signupLoginOptions(settings),
    );
  };

  const connected = channel?.state === "connected";
  return (
    <section className="core-panel core-form" aria-labelledby="wa-signup">
      {/* The screen cannot tell how a connected number was connected, so the
          heading names the action, never a state. */}
      <h2 id="wa-signup">
        {connected
          ? w("Connect through Facebook", "Sambung melalui Facebook")
          : w(
              "Connect your WhatsApp number",
              "Sambungkan nombor WhatsApp anda",
            )}
      </h2>
      {finishing && stage !== "waiting" ? (
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
                      "The Facebook window was closed before finishing, or your browser blocked it. Nothing was changed.",
                      "Tetingkap Facebook ditutup sebelum selesai, atau disekat oleh pelayar anda. Tiada apa-apa diubah.",
                    )
                  : w(
                      'Facebook did not return your number. Press the button again and, if Facebook offers to continue with your saved choices, pick "Edit settings" and choose the number again.',
                      'Facebook tidak memulangkan nombor anda. Tekan butang sekali lagi dan, jika Facebook menawarkan untuk meneruskan dengan pilihan tersimpan, pilih "Edit settings" dan pilih nombor itu semula.',
                    )}
            </p>
          )}
          {stage === "ready" && !problem && (
            <p className="editor-note" role="status">
              {w(
                "Facebook is ready. Press Continue to open its window.",
                "Facebook sudah sedia. Tekan Teruskan untuk membuka tetingkapnya.",
              )}
            </p>
          )}
          {stage === "waiting" && (
            <p className="editor-note" role="status">
              {w(
                "Finish the steps in the Facebook window. If no window opened, allow pop-ups for this site and press the button again.",
                "Lengkapkan langkah dalam tetingkap Facebook. Jika tiada tetingkap dibuka, benarkan pop timbul untuk laman ini dan tekan butang sekali lagi.",
              )}
            </p>
          )}
          <button
            type="button"
            className={
              connected && stage === "idle"
                ? "button secondary-button"
                : "button button-dark"
            }
            disabled={stage === "loading" || action.busy}
            onClick={() => void press()}
          >
            {stage === "loading"
              ? w("Loading Facebook…", "Memuatkan Facebook…")
              : action.busy
                ? w("Connecting…", "Menyambung…")
                : stage === "ready"
                  ? w("Continue to Facebook", "Teruskan ke Facebook")
                  : stage === "waiting"
                    ? w(
                        "Open the Facebook window again",
                        "Buka tetingkap Facebook sekali lagi",
                      )
                    : connected
                      ? w("Connect again", "Sambung semula")
                      : w("Connect WhatsApp", "Sambungkan WhatsApp")}
          </button>
          <p className="core-hint">
            {w(
              "The first press loads Facebook's sign-in on this page; the second opens a Facebook window.",
              "Tekanan pertama memuatkan log masuk Facebook pada halaman ini; tekanan kedua membuka tetingkap Facebook.",
            )}
          </p>
        </>
      )}
    </section>
  );
}
