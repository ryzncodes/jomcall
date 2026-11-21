"use client";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme-key";
import type { PublicTheme } from "./links";

// The theme lives on <html data-theme>, set before paint by the root
// layout's script. Components read it from there, so the static HTML always
// renders "light" and React switches after hydration without a mismatch.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
const current = (): PublicTheme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export function useTheme(): PublicTheme {
  return useSyncExternalStore(subscribe, current, () => "light");
}

function stored(): PublicTheme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: PublicTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeToggle({ label }: { label: string }) {
  const theme = useTheme();
  // React's development remount resets <html> attributes the script set;
  // put them back before paint. In production this changes nothing.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!root.dataset.theme)
      apply(
        stored() ??
          (window.matchMedia?.("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"),
      );
    const path = window.location.pathname;
    if (path === "/ms" || path.startsWith("/ms/")) root.lang = "ms";
  }, []);
  const toggle = () => {
    const next: PublicTheme = theme === "dark" ? "light" : "dark";
    apply(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  };
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-pressed={theme === "dark"}
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      <svg className="sun" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.24 1.24M14.06 14.06l1.24 1.24M4.7 15.3l1.24-1.24M14.06 5.94l1.24-1.24"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <svg className="moon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M16.5 12.2A6.75 6.75 0 0 1 7.8 3.5a6.75 6.75 0 1 0 8.7 8.7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
