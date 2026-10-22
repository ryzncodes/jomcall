"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { Locale } from "@/lib/api/types";
import type { SetupDraft } from "@/lib/api/product-types";
import { auditSetup } from "@/lib/api/admin";
import { productApi, readSetup, STORAGE_KEY } from "@/lib/api/product";
interface ProductContext {
  draft: SetupDraft | null;
  storage: "saving" | "saved" | "unavailable";
  update: (
    edit: (draft: SetupDraft) => SetupDraft,
    invalidate?: boolean,
  ) => void;
}
const Context = createContext<ProductContext>({
  draft: null,
  storage: "saving",
  update: () => {},
});
export const useProduct = () => useContext(Context);
export function ProductProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [storage, setStorage] = useState<ProductContext["storage"]>("saving");
  const latest = useRef<SetupDraft | null>(null);
  useEffect(() => {
    let active = true;
    const initial = readSetup(locale);
    latest.current = initial;
    setDraft(initial);
    void productApi.saveSetup(initial).then((saved) => {
      if (active) setStorage(saved ? "saved" : "unavailable");
    });
    const receive = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      const next = readSetup(locale);
      latest.current = next;
      setDraft(next);
      // Receiving another tab's write must not write its snapshot back.
      setStorage("saved");
    };
    window.addEventListener("storage", receive);
    return () => {
      active = false;
      window.removeEventListener("storage", receive);
    };
  }, [locale]);
  const update = useCallback(
    (edit: (d: SetupDraft) => SetupDraft, invalidate = false) => {
      let previous = latest.current;
      try {
        if (localStorage.getItem(STORAGE_KEY)) previous = readSetup(locale);
      } catch {
        // Storage may be blocked; preserve the current in-memory draft.
      }
      if (!previous) return;
      let next = auditSetup(previous, edit(structuredClone(previous)));
      if (invalidate)
        next = {
          ...next,
          test_passed: false,
          completed: false,
          completedSteps: next.completedSteps.filter((s) => s < 6),
          phone_line: { ...next.phone_line, verified: false },
        };
      latest.current = next;
      setDraft(next);
      // The local adapter writes synchronously, before an immediate navigation.
      void productApi
        .saveSetup(next)
        .then((saved) => setStorage(saved ? "saved" : "unavailable"));
    },
    [locale],
  );
  return (
    <Context.Provider value={{ draft, storage, update }}>
      {children}
    </Context.Provider>
  );
}
