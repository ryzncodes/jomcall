"use client";
// Cloudflare Turnstile widget, explicit rendering (docs checked 2026-11-14).
// Rendered only when the server passed a site key (hosted mode, both keys
// set). The script must load from Cloudflare's exact URL, never a copy.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  ready(run: () => void): void;
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "light" | "dark";
      language: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => boolean;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;
function load(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(Error());
    script.onerror = () => {
      loading = undefined;
      reject(Error());
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type TurnstileHandle = { reset(): void };

export const Turnstile = forwardRef<
  TurnstileHandle,
  {
    siteKey: string;
    action: "login" | "signup";
    theme: "light" | "dark";
    locale: "en" | "ms";
    onToken: (token: string) => void;
  }
>(function Turnstile({ siteKey, action, theme, locale, onToken }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string>(undefined);
  const latest = useRef(onToken);
  latest.current = onToken;
  useImperativeHandle(ref, () => ({
    // Tokens are single use: after every submit attempt, get a fresh one.
    reset() {
      latest.current("");
      if (widget.current) window.turnstile?.reset(widget.current);
    },
  }));
  useEffect(() => {
    let cancelled = false;
    load()
      .then((api) =>
        api.ready(() => {
          if (cancelled || !box.current) return;
          widget.current = api.render(box.current, {
            sitekey: siteKey,
            action,
            theme,
            language: locale,
            callback: (token) => latest.current(token),
            "expired-callback": () => latest.current(""),
            "error-callback": () => {
              latest.current("");
              return true;
            },
          });
        }),
      )
      .catch(() => latest.current(""));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey, action, theme, locale]);
  return <div ref={box} className="turnstile-box" />;
});
