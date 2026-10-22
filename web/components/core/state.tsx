"use client";
import { ZodError } from "zod";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  HttpCoreClient,
  CoreError,
  isResourceUnavailable,
} from "@/lib/core/client";
import type { Bootstrap, Session } from "../../../packages/contracts/src/core";
import { useExperience } from "../experience";
export const CoreContext = createContext<{
  client: HttpCoreClient;
  workspace: Bootstrap;
  session: Session;
  epoch: number;
  refresh: () => void;
  switchWorkspace: (id: string) => void;
}>({} as never);
export const useCore = () => useContext(CoreContext);
export function useWords() {
  const { locale } = useExperience();
  return (en: string, ms: string) => (locale === "ms" ? ms : en);
}
export function errorText(error: unknown, ms = false) {
  const code =
    error instanceof CoreError
      ? error.code
      : error instanceof ZodError
        ? "VALIDATION_ERROR"
        : "OFFLINE";
  const messages: Record<string, [string, string]> = {
    SLOT_UNAVAILABLE: [
      "Someone booked this time. Choose another slot.",
      "Waktu ini telah ditempah. Pilih waktu lain.",
    ],
    BOOKINGS_AFFECTED: [
      "Future appointments use this resource or schedule. Resolve them before making this change.",
      "Janji temu akan datang menggunakan sumber atau jadual ini. Selesaikannya sebelum membuat perubahan.",
    ],
    OUTSIDE_OPEN_HOURS: [
      "This time is outside saved branch hours. Choose another time.",
      "Waktu ini di luar waktu cawangan. Pilih waktu lain.",
    ],
    INVALID_BOOKING_TIME: [
      "Choose a 15-minute time slot, at least 15 minutes ahead and within 90 days.",
      "Pilih waktu sela 15 minit, sekurang-kurangnya 15 minit dari sekarang dan dalam 90 hari.",
    ],
    MODEL_UNAVAILABLE: [
      "Local model unavailable. Start it and retry. Your question is preserved.",
      "Model setempat tiada. Mulakan dan cuba lagi. Soalan anda dikekalkan.",
    ],
    MODEL_DISABLED: [
      "Local text inference is disabled. Knowledge and bookings still work.",
      "Inferens teks setempat dimatikan. Pengetahuan dan tempahan masih berfungsi.",
    ],
    MODEL_CHANGED: [
      "The model changed. Start a new test session.",
      "Model telah berubah. Mulakan sesi ujian baharu.",
    ],
    INPUT_BUDGET_EXCEEDED: [
      "This test exceeds the local model input budget. Shorten the question or agent instructions.",
      "Ujian melebihi had input model setempat. Pendekkan soalan atau arahan ejen.",
    ],
    TEST_EXPIRED: [
      "This test expired. Start a new session.",
      "Ujian tamat tempoh. Mulakan sesi baharu.",
    ],
    TURN_ACTIVE: [
      "A turn is already running. Wait or stop it first.",
      "Satu giliran sedang berjalan. Tunggu atau hentikannya dahulu.",
    ],
    TEST_SESSION_OWNER: [
      "Resume from the original signed-in session or start a new test.",
      "Sambung daripada sesi log masuk asal atau mulakan ujian baharu.",
    ],
    UNAUTHORIZED: [
      "Session ended. Sign in again.",
      "Sesi tamat. Log masuk semula.",
    ],
    FORBIDDEN: [
      "Your role cannot make this change.",
      "Peranan anda tidak dibenarkan membuat perubahan ini.",
    ],
    NOT_FOUND: [
      "Record unavailable or access removed.",
      "Rekod tiada atau akses ditarik balik.",
    ],
    CONFLICT: [
      "This record changed. Reload and review before saving again. Your input is preserved.",
      "Rekod telah berubah. Muat semula dan semak sebelum menyimpan. Input anda dikekalkan.",
    ],
    VALIDATION_ERROR: [
      "Check required fields and valid formats.",
      "Semak medan wajib dan format yang sah.",
    ],
    CAPABILITY_UNAVAILABLE: [
      "Available in a later phase.",
      "Tersedia dalam fasa akan datang.",
    ],
    AUTH_UNAVAILABLE: [
      "Local sign-in service unavailable. Start local services and retry.",
      "Perkhidmatan log masuk setempat tiada. Mulakan perkhidmatan dan cuba lagi.",
    ],
    DATABASE_UNAVAILABLE: [
      "Local database unavailable. Start local services and retry.",
      "Pangkalan data setempat tiada. Mulakan perkhidmatan dan cuba lagi.",
    ],
    OFFLINE: [
      "Connection interrupted. Your input is preserved.",
      "Sambungan terputus. Input anda dikekalkan.",
    ],
    DISCLOSURE_REQUIRED: [
      "Add greeting, AI introduction and recording notice before publishing.",
      "Tambah salam, pengenalan AI dan notis rakaman sebelum menerbitkan.",
    ],
    DELETION_PENDING: [
      "Deletion is pending. Editing is locked.",
      "Pemadaman sedang diproses. Suntingan dikunci.",
    ],
    EXPORT_EXPIRED: [
      "Export expired. Request a new export.",
      "Eksport tamat tempoh. Mohon eksport baharu.",
    ],
    LOCATION_IN_USE: [
      "Primary or assigned branch cannot be archived.",
      "Cawangan utama atau yang digunakan tidak boleh diarkibkan.",
    ],
  };
  return (messages[code] ?? [
    code.replaceAll("_", " "),
    code.replaceAll("_", " "),
  ])[ms ? 1 : 0];
}
export function useResource<T>(load: () => Promise<T>, key: string) {
  const { epoch } = useCore();
  const [record, setRecord] = useState<{ key: string; data: T }>();
  const [error, setError] = useState<unknown>();
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    let alive = true;
    const fetchData = () =>
      latest
        .current()
        .then((v) => {
          if (alive) {
            setRecord({ key, data: v });
            setError(undefined);
          }
        })
        .catch((e) => {
          if (alive) {
            setError(e);
            if (isResourceUnavailable(e)) setRecord(undefined);
          }
        });
    void fetchData();
    const focus = () => {
      if (document.visibilityState === "visible") void fetchData();
    };
    const timer = setInterval(focus, 15000);
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [key, epoch]);
  const reload = async () => {
    try {
      const data = await latest.current();
      setRecord({ key, data });
      setError(undefined);
      return true;
    } catch (e) {
      setError(e);
      if (isResourceUnavailable(e)) setRecord(undefined);
      return false;
    }
  };
  return { data: record?.key === key ? record.data : undefined, error, reload };
}
export function useAction() {
  const { refresh } = useCore();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false);
  const lock = useRef(false);
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const value = await action();
      refresh();
      setSaved(true);
      return value;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error, saved };
}
export function Notice({ error, saved }: { error?: unknown; saved?: boolean }) {
  const { locale, href } = useExperience();
  const w = useWords();
  return error ? (
    <div className="storage-warning" role="alert">
      {errorText(error, locale === "ms")}
      {error instanceof CoreError && error.status === 401 && (
        <a href={href("/login")}>{w(" Sign in", " Log masuk")}</a>
      )}
    </div>
  ) : saved ? (
    <p className="core-success" role="status">
      {w("Saved to local workspace.", "Disimpan dalam ruang kerja setempat.")}
    </p>
  ) : null;
}
export function Loading({ error }: { error?: unknown }) {
  const w = useWords();
  return error ? (
    <Notice error={error} />
  ) : (
    <p role="status">{w("Loading workspace…", "Memuatkan ruang kerja…")}</p>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="product-page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
