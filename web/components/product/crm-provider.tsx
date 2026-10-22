"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type SetStateAction,
} from "react";
import { CRM_KEY, crmApi, seedCrm, type CrmData } from "@/lib/api/crm";
import { useProduct } from "./provider";
import { serviceApi, walletBalance } from "@/lib/api/service";
import type { Locale } from "@/lib/api/types";
const Context = createContext<{
  data: CrmData | null;
  saved: boolean;
  error: boolean;
  setData: (edit: SetStateAction<CrmData | null>) => void;
}>({ data: null, saved: true, error: false, setData: () => {} });
export const useCrm = () => useContext(Context);
export function CrmProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const { draft, update } = useProduct();
  const [data, rawSet] = useState<CrmData | null>(null),
    [saved, setSaved] = useState(true),
    [error, setError] = useState(false),
    latest = useRef<CrmData | null>(null);
  useEffect(() => {
    try {
      const initial = crmApi.load(locale);
      latest.current = initial;
      rawSet(initial);
      try {
        crmApi.save(initial);
      } catch {
        setSaved(false);
      }
    } catch {
      // Storage denial can still run in memory. Malformed saved data is preserved.
      try {
        localStorage.getItem(CRM_KEY);
        setError(true);
      } catch {
        const temporary = seedCrm(locale);
        latest.current = temporary;
        rawSet(temporary);
      }
      setSaved(false);
    }
    const receive = (event: StorageEvent) => {
      if (event.key !== CRM_KEY || !event.newValue) return;
      try {
        const next = crmApi.load(locale, false);
        latest.current = next;
        rawSet(next);
        setError(false);
        setSaved(true);
      } catch {
        setError(true);
        setSaved(false);
      }
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, [locale]);
  // Workflow receipts reconcile whichever screen confirms the outcome.
  useEffect(() => {
    if (!draft || !data) return;
    const due = serviceApi
      .candidates(data)
      .filter(
        (u) =>
          u.id.startsWith("usage-workflow-") &&
          !draft.services.usage.some((x) => x.id === u.id),
      );
    if (due.some((u) => walletBalance(draft) >= u.amount_sen))
      update((current) =>
        due.reduce((next, usage) => serviceApi.charge(next, usage), current),
      );
  }, [draft, data, update]);
  const setData = useCallback(
    (edit: SetStateAction<CrmData | null>) => {
      // Persist before navigation; read the latest shared snapshot before each mutation.
      let previous = latest.current;
      try {
        if (localStorage.getItem(CRM_KEY))
          previous = crmApi.load(locale, false);
      } catch {
        setSaved(false);
      }
      const value = typeof edit === "function" ? edit(previous) : edit;
      const next = previous && value ? crmApi.audit(previous, value) : value;
      latest.current = next;
      rawSet(next);
      if (next)
        try {
          crmApi.save(next);
          setSaved(true);
        } catch {
          setSaved(false);
        }
    },
    [locale],
  );
  return (
    <Context.Provider value={{ data, saved, error, setData }}>
      {children}
    </Context.Provider>
  );
}
