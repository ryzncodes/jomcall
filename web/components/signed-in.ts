"use client";
import { useEffect, useState } from "react";

// One check per page load, shared by every caller: the header and the form
// ask together, and a part that mounts again reads the answer at once.
let known: string | null | undefined;
let asking: Promise<string | null> | undefined;
function ask(): Promise<string | null> {
  asking ??= fetch("/api/v1/session", {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) =>
      v?.ok && typeof v.data?.email === "string" ? (v.data.email as string) : null,
    )
    .catch(() => null)
    .then((email) => (known = email));
  return asking;
}

// Whether this browser is signed in, for the public pages: the email, null
// when signed out (or the check failed), undefined while checking. It reads
// the session with a plain request so the preview bundle needs no app code.
export function useSignedIn(enabled: boolean): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(
    enabled ? known : null,
  );
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void ask().then((v) => {
      if (alive) setEmail(v);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return enabled ? email : null;
}
