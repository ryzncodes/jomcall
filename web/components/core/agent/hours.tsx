"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoreError, ProxyError } from "@/lib/core/client";
import type { Location } from "../../../../packages/contracts/src/core";
import { useExperience } from "../../experience";
import { Field } from "../field";
import { Notice, errorText, useCore, useWords, useResource } from "../state";
import { HoursWeek, dateWords, type Sync } from "./hours-week";
import { closedWeek, weekSummary, type Interval } from "./rules";
import {
  createScheduleSync,
  createHoursStore,
  type ScheduleData,
} from "./schedule-sync";

const KL = "Asia/Kuala_Lumpur";
const isConflict = (e: unknown) =>
  e instanceof CoreError && e.status === 409 && e.code === "CONFLICT";
// No answer arrived: a network error, or a proxy's 502/503/504 page.
const isLost = (e: unknown) =>
  e instanceof TypeError ||
  (e instanceof ProxyError && [502, 503, 504].includes(e.status));

const mainFirst = (list: Location[]) =>
  [...list].sort(
    (a, b) => Number(b.primary_location) - Number(a.primary_location),
  );
const DAYS: [string, string][] = [
  ["Monday", "Isnin"],
  ["Tuesday", "Selasa"],
  ["Wednesday", "Rabu"],
  ["Thursday", "Khamis"],
  ["Friday", "Jumaat"],
  ["Saturday", "Sabtu"],
  ["Sunday", "Ahad"],
];

type Props = {
  // Owners and admins edit; staff get a read-only copy.
  editable: boolean;
  // Moves home's "changes not live" count after a save.
  refreshChanges?: () => void;
  // The page's syncs, so typed and unsaved rows outlive this view.
  store?: ReturnType<typeof createHoursStore>;
};

// Opening hours, one branch at a time. Saves go through the branch's own
// sync (one at a time, with that schedule's revision); they do not use the
// agent's save queue because they do not check the agent revision.
// Stands in for the page's store in the read-only view, which never uses it.
const readOnlyStore = createHoursStore();
export function Hours({ editable, refreshChanges, store: given }: Props) {
  const store = given ?? readOnlyStore;
  const w = useWords(),
    { client, workspace } = useCore(),
    { href } = useExperience();
  const list = useResource(
    () => client.execute("locations", {}),
    "hours-locations",
  );
  // A branch made here shows at once, even before the list is read again.
  const [made, setMade] = useState<Location[]>([]);
  const branches = useMemo(() => {
    const read = list.data ?? workspace.locations;
    return mainFirst([
      ...read,
      ...made.filter((m) => !read.some((r) => r.id === m.id)),
    ]);
  }, [list.data, workspace.locations, made]);
  const [chosen, setChosen] = useState<string>(""),
    [adding, setAdding] = useState(false),
    [, tick] = useState(0);
  // The page's store; the unsaved-hours leave warning lives with it.
  useEffect(() => store.subscribe(() => tick((n) => n + 1)), [store]);
  const loading = useRef(new Set<string>()),
    [loadErrors, setLoadErrors] = useState<Record<string, unknown>>({});
  const changed = useRef(refreshChanges);
  changed.current = refreshChanges;
  const current = branches.find((b) => b.id === chosen) ?? branches[0];
  const id = current?.id ?? "";

  const make = (branch: string, initial: ScheduleData) => {
    const sync = createScheduleSync({
      initial,
      newKey: () => crypto.randomUUID(),
      isConflict,
      isLost,
      send: (body, revision, key) =>
        client.execute(
          "saveSchedule",
          { id: branch, expectedRevision: revision, ...body },
          key,
        ) as Promise<ScheduleData>,
      read: () =>
        client.execute("schedule", { id: branch }) as Promise<ScheduleData>,
      onChange: () => store.notify(),
      onSaved: () => changed.current?.(),
    });
    store.set(branch, sync);
    return sync;
  };

  const load = (branch: string) => {
    if (!branch || store.get(branch) || loading.current.has(branch)) return;
    loading.current.add(branch);
    client
      .execute("schedule", { id: branch })
      .then((s) => {
        if (!store.get(branch)) make(branch, s as ScheduleData);
        setLoadErrors(({ [branch]: _g, ...rest }) => rest);
        tick((n) => n + 1);
      })
      .catch((e) => setLoadErrors((m) => ({ ...m, [branch]: e })))
      .finally(() => loading.current.delete(branch));
  };
  useEffect(() => {
    if (!current) return;
    if (!editable) return;
    const existing = store.get(id);
    // Back on a branch already held by the page: read it again in place, so
    // another tab's change shows and typed rows stay. A failed read is
    // ignored; the next save reports.
    if (existing) existing.reload().catch(() => {});
    else load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editable]);

  if (!editable) return <ReadOnlyHours branches={branches} />;

  const sync = store.get(id);
  return (
    <section className="agent-view" aria-labelledby="agent-hours-h">
      <h2 id="agent-hours-h">{w("Opening hours", "Waktu operasi")}</h2>
      <div
        className="agent-chips"
        role="group"
        aria-label={w("Branch", "Cawangan")}
      >
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            className="agent-chip"
            aria-pressed={!adding && b.id === id}
            onClick={() => {
              setChosen(b.id);
              setAdding(false);
            }}
          >
            {b.name}
          </button>
        ))}
        <button
          type="button"
          className="agent-chip"
          aria-pressed={adding}
          onClick={() => setAdding(true)}
        >
          {w("+ Branch", "+ Cawangan")}
        </button>
      </div>
      <Notice error={list.error} context="hours" />
      {adding ? (
        <NewBranch
          main={branches.find((b) => b.primary_location)}
          onCancel={() => setAdding(false)}
          onMade={(location) => setMade((m) => [...m, location])}
          onReady={(location, initial, copy) => {
            const s = store.get(location.id) ?? make(location.id, initial);
            setChosen(location.id);
            setAdding(false);
            if (copy) {
              s.setWeek(copy);
              s.save();
            }
            void list.reload();
          }}
        />
      ) : !current ? (
        <p aria-busy="true">{w("Loading...", "Memuatkan...")}</p>
      ) : loadErrors[id] ? (
        <div>
          <Notice error={loadErrors[id]} context="hours" />
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              setLoadErrors(({ [id]: _g, ...rest }) => rest);
              load(id);
            }}
          >
            {w("Try again", "Cuba lagi")}
          </button>
        </div>
      ) : !sync ? (
        <p aria-busy="true">{w("Loading...", "Memuatkan...")}</p>
      ) : (
        <>
          {sync.state().server.revision === 0 && (
            <p className="agent-notice" role="status">
              {w("Hours not set yet", "Waktu belum ditetapkan")}
            </p>
          )}
          <p className="core-hint" aria-live="polite">
            {(() => {
              const t = weekSummary(
                sync.state().server.revision === 0
                  ? null
                  : sync.state().server.weekdays,
              );
              return w(t.en, t.ms);
            })()}
          </p>
          <HoursWeek key={id} sync={sync} branch={id} />
          <p className="core-hint">
            {w(
              "The agent says these hours on calls and WhatsApp after you publish. Bookings follow them straight away.",
              "Ejen menyebut waktu ini dalam panggilan dan WhatsApp selepas anda terbitkan. Tempahan mengikutnya serta-merta.",
            )}
          </p>
          <p className="core-hint">
            {w(
              "Change a branch's name, address or state in ",
              "Tukar nama, alamat atau negeri cawangan dalam ",
            )}
            <a href={href("/app/settings")}>{w("Settings", "Tetapan")}</a>.
          </p>
        </>
      )}
    </section>
  );
}

type Attempt = {
  signature: string;
  key: string;
  created?: Location;
};

// "+ Branch": name, address and state; the time zone is Kuala Lumpur. The
// branch is made once (one idempotency key per form, kept while it has not
// worked); then the main branch's week is copied. If that second save fails,
// the branch stays, shown with "Hours not set yet" and the error.
function NewBranch({
  main,
  onCancel,
  onMade,
  onReady,
}: {
  main: Location | undefined;
  onCancel: () => void;
  onMade: (l: Location) => void;
  onReady: (
    l: Location,
    initial: ScheduleData,
    copy: Interval[][] | null,
  ) => void;
}) {
  const w = useWords(),
    { client } = useCore();
  const [values, setValues] = useState({ name: "", address: "", state: "" }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [nameMissing, setNameMissing] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<Attempt>(undefined);
  const lock = useRef(false);
  const submit = async () => {
    if (lock.current) return;
    if (!values.name.trim()) {
      setNameMissing(true);
      nameInput.current?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        name: values.name.trim(),
        address: values.address.trim(),
        state: values.state.trim(),
        timezone: KL,
      };
      const signature = JSON.stringify(body);
      if (
        !attempt.current ||
        (attempt.current.signature !== signature && !attempt.current.created)
      )
        attempt.current = { signature, key: crypto.randomUUID() };
      // The main branch's week is read before anything is created, so a
      // failed read creates nothing.
      const mainSchedule = main
        ? ((await client.execute("schedule", { id: main.id })) as ScheduleData)
        : undefined;
      let location = attempt.current.created;
      if (!location) {
        location = await client.execute(
          "createLocation",
          body,
          attempt.current.key,
        );
        attempt.current.created = location;
        onMade(location);
      }
      onReady(
        location,
        {
          timezone: KL,
          weekdays: closedWeek.map(() => []),
          closures: [],
          revision: 0,
        },
        mainSchedule && mainSchedule.revision > 0
          ? mainSchedule.weekdays
          : null,
      );
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      className="agent-branch-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>{w("New branch", "Cawangan baharu")}</h3>
      <p className="core-hint">
        {w(
          `It starts with a copy of ${main?.name ?? "the main branch"}'s hours. Time zone is Kuala Lumpur.`,
          `Ia bermula dengan salinan waktu ${main?.name ?? "cawangan utama"}. Zon masa ialah Kuala Lumpur.`,
        )}
      </p>
      <Field label={w("Branch name", "Nama cawangan")}>
        <input
          ref={nameInput}
          required
          maxLength={120}
          aria-invalid={nameMissing || undefined}
          value={values.name}
          onChange={(e) => {
            setNameMissing(false);
            setValues({ ...values, name: e.target.value });
          }}
        />
      </Field>
      {nameMissing && (
        <p role="alert" className="storage-warning">
          {w("Give the branch a name.", "Berikan nama cawangan.")}
        </p>
      )}
      <Field label={w("Address", "Alamat")}>
        <textarea
          rows={3}
          maxLength={500}
          value={values.address}
          onChange={(e) => setValues({ ...values, address: e.target.value })}
        />
      </Field>
      <Field label={w("State", "Negeri")}>
        <input
          maxLength={100}
          value={values.state}
          onChange={(e) => setValues({ ...values, state: e.target.value })}
        />
      </Field>
      <Notice error={error} context="hours" />
      <div className="agent-day-actions">
        <button className="button button-dark" disabled={busy}>
          {w("Add branch", "Tambah cawangan")}
        </button>
        <button
          type="button"
          className="button secondary-button"
          disabled={busy}
          onClick={onCancel}
        >
          {w("Cancel", "Batal")}
        </button>
      </div>
    </form>
  );
}

// Staff can read the hours (they could before this page) but not change them.
function ReadOnlyHours({ branches }: { branches: Location[] }) {
  const w = useWords(),
    { client } = useCore(),
    { locale } = useExperience(),
    ms = locale === "ms";
  const [chosen, setChosen] = useState("");
  const id = branches.find((b) => b.id === chosen)?.id ?? branches[0]?.id ?? "";
  const r = useResource(
    () =>
      id
        ? (client.execute("schedule", { id }) as Promise<ScheduleData>)
        : Promise.resolve(null),
    "hours-ro-" + id,
  );
  const clock = (t: string) => t.replace(/^0/, "");
  return (
    <section className="agent-view" aria-labelledby="agent-hours-h">
      <h2 id="agent-hours-h">{w("Opening hours", "Waktu operasi")}</h2>
      {branches.length > 1 && (
        <div
          className="agent-chips"
          role="group"
          aria-label={w("Branch", "Cawangan")}
        >
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              className="agent-chip"
              aria-pressed={b.id === id}
              onClick={() => setChosen(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
      {r.error ? (
        <p role="alert" className="storage-warning">
          {errorText(r.error, ms, "hours")}
        </p>
      ) : !r.data ? (
        <p aria-busy="true">{w("Loading...", "Memuatkan...")}</p>
      ) : r.data.revision === 0 ? (
        <p>{w("Hours not set yet", "Waktu belum ditetapkan")}</p>
      ) : (
        <>
          <ul className="agent-days">
            {r.data.weekdays.map((blocks, d) => (
              <li key={d} className="agent-day">
                <strong>{w(DAYS[d]![0], DAYS[d]![1])}</strong>{" "}
                <span>
                  {blocks.length
                    ? blocks
                        .map(
                          (b) =>
                            `${clock(b.start)} ${w("to", "hingga")} ${clock(b.end)}`,
                        )
                        .join(", ")
                    : w("Closed", "Tutup")}
                </span>
              </li>
            ))}
          </ul>
          {r.data.closures.length > 0 && (
            <>
              <h3>{w("Closed dates", "Tarikh tutup")}</h3>
              <ul className="agent-closed-list">
                {[...r.data.closures]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((c) => (
                    <li key={c.date}>
                      <span>
                        <strong>{dateWords(c.date, ms)}</strong>
                        {c.reason && <small>{c.reason}</small>}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      )}
      <p className="core-hint">
        {w(
          "Your owner or admin changes these hours.",
          "Pemilik atau pentadbir menukar waktu ini.",
        )}
      </p>
    </section>
  );
}
