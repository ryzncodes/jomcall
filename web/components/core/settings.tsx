"use client";
import { useEffect, useState } from "react";
import type { Location, Schedule } from "../../../packages/contracts/src/core";
import { useExperience } from "../experience";
import { Field } from "./field";
import {
  useCore,
  useWords,
  useResource,
  useAction,
  Heading,
  Notice,
  Loading,
} from "./state";
import { JobRow } from "./contacts";
export function LocalSettings() {
  const w = useWords(),
    { client, workspace, session, switchWorkspace } = useCore(),
    { href } = useExperience(),
    a = useAction();
  const [tab, setTab] = useState("business"),
    [revision, setRevision] = useState(workspace.workspace.revision);
  const manager = workspace.role !== "staff";
  return (
    <>
      <Heading
        title={w(
          "A workspace that fits your team.",
          "Ruang kerja yang sesuai untuk pasukan.",
        )}
        description={w(
          "Manage your business, access and privacy in one place.",
          "Urus perniagaan, akses dan privasi di satu tempat.",
        )}
      />
      <div className="core-workspace-switch">
        <Field label={w("Current workspace", "Ruang kerja semasa")}>
          <select
            value={workspace.workspace.id}
            onChange={(e) => switchWorkspace(e.target.value)}
          >
            {session.memberships.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.role}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="button secondary-button"
          disabled={a.busy}
          onClick={async () => {
            if (await a.run(() => client.auth("logout", {})))
              location.assign(href("/login"));
          }}
        >
          {w("Sign out", "Log keluar")}
        </button>
      </div>
      <Notice {...a} />
      <div className="builder-tabs">
        {["business", "team", "privacy", "audit"].map((key, i) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
          >
            {
              [
                w("Business", "Perniagaan"),
                w("Team & access", "Pasukan & akses"),
                w("Privacy jobs", "Tugas privasi"),
                w("Audit history", "Sejarah audit"),
              ][i]
            }
          </button>
        ))}
      </div>
      {tab === "business" ? (
        <div className="core-two-columns">
          <section className="core-panel">
            <h2>{w("Business profile", "Profil perniagaan")}</h2>
            <form
              className="core-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const result = await a.run(() =>
                  client.execute("updateOrganization", {
                    id: workspace.workspace.id,
                    expectedRevision: revision,
                    name: String(f.get("name")),
                    businessType: String(f.get("businessType")),
                  }),
                );
                if (result) setRevision(result.revision);
              }}
            >
              <fieldset disabled={!manager || a.busy}>
                <Field label={w("Business name", "Nama perniagaan")}>
                  <input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={workspace.workspace.name}
                  />
                </Field>
                <Field label={w("Business type", "Jenis perniagaan")}>
                  <input
                    name="businessType"
                    required
                    maxLength={80}
                    defaultValue={workspace.workspace.business_type}
                  />
                </Field>
                <button className="button button-dark">
                  {w("Save business", "Simpan perniagaan")}
                </button>
              </fieldset>
            </form>
            <p className="editor-note">
              {w(
                "Roles control access to every command. Ownership transfer is outside this phase.",
                "Peranan mengawal akses setiap arahan. Pemindahan pemilikan di luar skop fasa ini.",
              )}
            </p>
          </section>
          <section className="core-panel">
            <h2>{w("Another business?", "Perniagaan lain?")}</h2>
            <p>
              {w(
                "Each workspace has separate members and records.",
                "Setiap ruang kerja mempunyai ahli dan rekod berasingan.",
              )}
            </p>
            <form
              className="core-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const r = await a.run(() =>
                  client.execute("createOrganization", {
                    name: String(f.get("name")),
                    businessType: String(f.get("businessType")),
                    primaryLocationName: String(f.get("branch")),
                  }),
                );
                if (r) switchWorkspace(r.orgId);
              }}
            >
              <Field label={w("New business name", "Nama perniagaan baharu")}>
                <input name="name" required maxLength={120} />
              </Field>
              <Field label={w("New business type", "Jenis perniagaan baharu")}>
                <input name="businessType" required maxLength={80} />
              </Field>
              <Field label={w("Primary branch", "Cawangan utama")}>
                <input name="branch" required maxLength={120} />
              </Field>
              <button disabled={a.busy} className="button secondary-button">
                {w("Create separate workspace", "Cipta ruang kerja berasingan")}
              </button>
            </form>
          </section>
        </div>
      ) : tab === "team" ? (
        <Team />
      ) : !manager ? (
        <p>
          {w(
            "Only owners and admins can access this section.",
            "Hanya pemilik dan pentadbir boleh mengakses bahagian ini.",
          )}
        </p>
      ) : tab === "privacy" ? (
        <Jobs />
      ) : (
        <Audit />
      )}
    </>
  );
}
function Team() {
  const { client, workspace, session } = useCore(),
    w = useWords(),
    a = useAction();
  const r = useResource(() => client.execute("members", {}), "members"),
    inv = useResource(
      () =>
        workspace.role === "staff"
          ? Promise.resolve([])
          : client.execute("invitations", {}),
      "invites",
    );
  return (
    <div className="core-two-columns">
      <section className="core-panel">
        <h2>{w("Your team", "Pasukan anda")}</h2>
        <Notice {...a} />
        {r.error || !r.data ? (
          <Loading error={r.error} />
        ) : (
          r.data.map((m, i) => (
            <article className="core-record" key={m.id}>
              <h3>
                {m.user_id === session.userId ? w("You", "Anda") : m.email}
              </h3>
              <p>
                {m.role} ·{" "}
                {m.active
                  ? w("Active", "Aktif")
                  : w("Revoked", "Ditarik balik")}
              </p>
              {m.role !== "owner" &&
                m.active &&
                workspace.role !== "staff" &&
                (workspace.role === "owner" || m.role === "staff") && (
                  <div className="core-actions">
                    {workspace.role === "owner" && (
                      <button
                        disabled={a.busy}
                        onClick={() =>
                          a.run(() =>
                            client.execute("changeMember", {
                              id: m.id,
                              expectedRevision: m.revision,
                              role: m.role === "admin" ? "staff" : "admin",
                            }),
                          )
                        }
                      >
                        {m.role === "admin"
                          ? w("Make staff", "Jadikan staf")
                          : w("Make admin", "Jadikan pentadbir")}
                      </button>
                    )}
                    <button
                      disabled={a.busy}
                      onClick={() =>
                        a.run(() =>
                          client.execute("revokeMember", {
                            id: m.id,
                            expectedRevision: m.revision,
                          }),
                        )
                      }
                    >
                      {w("Revoke access", "Tarik balik akses")}
                    </button>
                  </div>
                )}
            </article>
          ))
        )}
      </section>
      {workspace.role !== "staff" && (
        <section className="core-panel">
          <h2>{w("Invite someone", "Jemput seseorang")}</h2>
          <p>
            {w(
              "Invitations are delivered to local Mailpit. The recipient must confirm their own account.",
              "Jemputan dihantar ke Mailpit setempat. Penerima perlu mengesahkan akaun sendiri.",
            )}
          </p>
          <form
            className="core-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              if (
                await a.run(() =>
                  client.execute("invite", {
                    email: String(f.get("email")),
                    role: f.get("role") as "admin" | "staff",
                  }),
                )
              )
                form.reset();
            }}
          >
            <Field label={w("Invite email", "E-mel jemputan")}>
              <input name="email" type="email" required maxLength={254} />
            </Field>
            <Field label={w("Role", "Peranan")}>
              <select name="role">
                <option value="staff">{w("Staff", "Staf")}</option>
                {workspace.role === "owner" && (
                  <option value="admin">{w("Admin", "Pentadbir")}</option>
                )}
              </select>
            </Field>
            <button disabled={a.busy} className="button button-dark">
              {w("Send local invitation", "Hantar jemputan setempat")}
            </button>
          </form>
          <Notice error={inv.error} />
          {inv.data?.map((i) => (
            <article className="core-record" key={i.id}>
              <strong>{i.email}</strong>
              <p>
                {i.role} · {i.state} · {i.delivery_state}
              </p>
              {i.state === "pending" &&
                (workspace.role === "owner" || i.role === "staff") && (
                  <div className="core-actions">
                    <button
                      disabled={a.busy}
                      onClick={() =>
                        a.run(() =>
                          client.execute("resendInvite", { id: i.id }),
                        )
                      }
                    >
                      {w("Resend", "Hantar semula")}
                    </button>
                    <button
                      disabled={a.busy}
                      onClick={() =>
                        a.run(() =>
                          client.execute("revokeInvite", { id: i.id }),
                        )
                      }
                    >
                      {w("Cancel invitation", "Batal jemputan")}
                    </button>
                  </div>
                )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
function Jobs() {
  const { client } = useCore(),
    w = useWords(),
    r = useResource(() => client.execute("jobs", {}), "jobs");
  return (
    <section className="core-panel">
      <h2>{w("Privacy requests", "Permintaan privasi")}</h2>
      <p>
        {w(
          "Jobs run in the local engine, even after you leave this page. Pending jobs wait if the engine is stopped.",
          "Tugas berjalan dalam enjin setempat walaupun anda meninggalkan halaman ini. Tugas menunggu jika enjin dihentikan.",
        )}
      </p>
      {r.error || !r.data ? (
        <Loading error={r.error} />
      ) : !r.data.length ? (
        <p>{w("No privacy requests yet.", "Belum ada permintaan privasi.")}</p>
      ) : (
        r.data.map((j) => <JobRow key={j.id} job={j} />)
      )}
    </section>
  );
}
function Audit() {
  const { client } = useCore(),
    w = useWords(),
    [cursor, setCursor] = useState<string>(),
    r = useResource(
      () => client.execute("audit", { cursor }),
      "audit" + cursor,
    );
  return (
    <section className="core-panel">
      <h2>{w("Workspace history", "Sejarah ruang kerja")}</h2>
      {r.error || !r.data ? (
        <Loading error={r.error} />
      ) : (
        r.data.items.map((item) => (
          <article className="core-record" key={item.id}>
            <strong>{item.action.replaceAll(".", " · ")}</strong>
            <p>
              {new Date(item.created_at).toLocaleString("en-MY", {
                timeZone: "Asia/Kuala_Lumpur",
              })}
            </p>
          </article>
        ))
      )}
      <div className="core-actions">
        {cursor && (
          <button onClick={() => setCursor(undefined)}>
            {w("Most recent", "Terkini")}
          </button>
        )}
        {r.data?.nextCursor && (
          <button onClick={() => setCursor(r.data!.nextCursor!)}>
            {w("Older events", "Peristiwa terdahulu")}
          </button>
        )}
      </div>
    </section>
  );
}
export function LocalHours() {
  const { client, workspace } = useCore(),
    w = useWords(),
    { href } = useExperience(),
    a = useAction();
  const [chosen, setChosen] = useState(workspace.locations[0]?.id ?? ""),
    [adding, setAdding] = useState(false),
    [reload, setReload] = useState(0);
  const branches = useResource(
      () => client.execute("locations", {}),
      "locations",
    ),
    r = useResource(
      () =>
        chosen
          ? client.execute("schedule", { id: chosen })
          : Promise.resolve(null),
      chosen,
    );
  const selected = branches.data?.find((l) => l.id === chosen);
  useEffect(() => {
    if (branches.data && !adding && !branches.data.some((l) => l.id === chosen))
      setChosen(branches.data[0]?.id ?? "");
  }, [branches.data, chosen, adding]);
  return (
    <>
      <Heading
        title={w("Open at the right time.", "Buka pada waktu yang tepat.")}
        description={w(
          "Branches, weekly hours and closure dates. These records do not write to an external calendar.",
          "Cawangan, waktu mingguan dan tarikh tutup. Rekod ini tidak menulis ke kalendar luaran.",
        )}
      />
      <div className="core-actions">
        <a href={href("/app/bookings")}>
          {w("Open local bookings", "Buka tempahan setempat")}
        </a>
      </div>
      <Notice {...a} />
      <div className="core-workspace-switch">
        <Field label={w("Branch", "Cawangan")}>
          <select
            value={chosen}
            onChange={(e) => {
              setChosen(e.target.value);
              setAdding(false);
              setReload((v) => v + 1);
            }}
          >
            {branches.data?.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
                {l.primary_location ? " · " + w("Primary", "Utama") : ""}
              </option>
            ))}
          </select>
        </Field>
        {workspace.role !== "staff" && (
          <button
            className="button secondary-button"
            onClick={() => setAdding(!adding)}
          >
            {w("Add branch", "Tambah cawangan")}
          </button>
        )}
        <button
          className="button secondary-button"
          onClick={async () => {
            const [b, s] = await Promise.all([branches.reload(), r.reload()]);
            if (b && s) setReload((v) => v + 1);
          }}
        >
          {w("Reload latest values", "Muat semula nilai terkini")}
        </button>
      </div>
      <Notice error={branches.error} />
      <Notice error={r.error} />
      {adding ? (
        <BranchForm
          onSaved={(l) => {
            setChosen(l.id);
            setAdding(false);
          }}
        />
      ) : selected ? (
        <div className="core-two-columns">
          <BranchForm
            key={"branch-" + chosen + reload}
            branch={selected}
            onSaved={() => {}}
          />
          {!r.data ? (
            <Loading error={r.error} />
          ) : (
            <ScheduleForm
              key={"schedule-" + chosen + reload}
              branch={selected}
              initial={r.data}
            />
          )}
        </div>
      ) : (
        <Loading />
      )}
    </>
  );
}
function BranchForm({
  branch,
  onSaved,
}: {
  branch?: Location;
  onSaved: (l: Location) => void;
}) {
  const w = useWords(),
    { client, workspace } = useCore(),
    a = useAction();
  const [revision, setRevision] = useState(branch?.revision ?? 1);
  return (
    <section className="core-panel">
      <h2>
        {branch
          ? w("Branch details", "Butiran cawangan")
          : w("New branch", "Cawangan baharu")}
      </h2>
      <Notice {...a} />
      <form
        className="core-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            v = {
              name: String(f.get("name")),
              address: String(f.get("address")),
              state: String(f.get("state")),
              timezone: String(f.get("timezone")),
            };
          const r = await a.run(() =>
            branch
              ? client.execute("updateLocation", {
                  id: branch.id,
                  expectedRevision: revision,
                  ...v,
                })
              : client.execute("createLocation", v),
          );
          if (r) {
            setRevision(r.revision);
            onSaved(r);
          }
        }}
      >
        <fieldset disabled={workspace.role === "staff" || a.busy}>
          <Field label={w("Branch name", "Nama cawangan")}>
            <input
              required
              maxLength={120}
              name="name"
              defaultValue={branch?.name ?? ""}
            />
          </Field>
          <Field label={w("Address", "Alamat")}>
            <textarea
              name="address"
              maxLength={500}
              rows={3}
              defaultValue={branch?.address ?? ""}
            />
          </Field>
          <Field label={w("State", "Negeri")}>
            <input
              name="state"
              maxLength={100}
              defaultValue={branch?.state ?? ""}
            />
          </Field>
          <Field label={w("Time zone", "Zon masa")}>
            <input
              name="timezone"
              required
              defaultValue={branch?.timezone ?? "Asia/Kuala_Lumpur"}
            />
          </Field>
          <button className="button button-dark">
            {w("Save branch", "Simpan cawangan")}
          </button>
          {branch && !branch.primary_location && (
            <button
              type="button"
              className="button secondary-button"
              onClick={() =>
                a.run(() =>
                  client.execute("archiveLocation", {
                    id: branch.id,
                    expectedRevision: revision,
                  }),
                )
              }
            >
              {w("Archive branch", "Arkibkan cawangan")}
            </button>
          )}
        </fieldset>
      </form>
    </section>
  );
}
function ScheduleForm({
  branch,
  initial,
}: {
  branch: Location;
  initial: Schedule;
}) {
  const w = useWords(),
    { client, workspace } = useCore(),
    a = useAction();
  const [s, setS] = useState(initial),
    [date, setDate] = useState(""),
    [reason, setReason] = useState("");
  const days = [
    w("Monday", "Isnin"),
    w("Tuesday", "Selasa"),
    w("Wednesday", "Rabu"),
    w("Thursday", "Khamis"),
    w("Friday", "Jumaat"),
    w("Saturday", "Sabtu"),
    w("Sunday", "Ahad"),
  ];
  return (
    <section className="core-panel">
      <h2>{w("Weekly hours", "Waktu mingguan")}</h2>
      <Notice {...a} />
      <form
        className="core-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.run(() =>
            client.execute("saveSchedule", {
              id: branch.id,
              expectedRevision: s.revision,
              timezone: s.timezone,
              weekdays: s.weekdays,
              closures: s.closures,
            }),
          );
          if (r) setS(r);
        }}
      >
        <fieldset disabled={workspace.role === "staff" || a.busy}>
          <Field label={w("Schedule time zone", "Zon masa jadual")}>
            <input
              required
              value={s.timezone}
              onChange={(e) =>
                setS((v) => ({ ...v, timezone: e.target.value }))
              }
            />
          </Field>
          {s.weekdays.map((intervals, day) => (
            <div key={day} className="core-hours-day">
              <strong>{days[day]}</strong>
              {!intervals.length && <span>{w("Closed", "Tutup")}</span>}
              {intervals.map((interval, i) => (
                <div className="core-hour-pair" key={i}>
                  {(["start", "end"] as const).map((key) => (
                    <Field
                      key={key}
                      label={
                        days[day] +
                        " " +
                        (key === "start"
                          ? w("opens", "buka")
                          : w("closes", "tutup"))
                      }
                    >
                      <input
                        required
                        aria-label={days[day] + " " + key + " " + (i + 1)}
                        placeholder="09:00"
                        pattern={
                          key === "end"
                            ? "([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                            : "([01][0-9]|2[0-3]):[0-5][0-9]"
                        }
                        value={interval[key]}
                        onChange={(e) =>
                          setS((v) => ({
                            ...v,
                            weekdays: v.weekdays.map((xs, d) =>
                              d === day
                                ? xs.map((x, j) =>
                                    j === i
                                      ? { ...x, [key]: e.target.value }
                                      : x,
                                  )
                                : xs,
                            ),
                          }))
                        }
                      />
                    </Field>
                  ))}
                  <button
                    type="button"
                    aria-label={
                      w("Remove interval", "Buang waktu") +
                      " " +
                      days[day] +
                      " " +
                      (i + 1)
                    }
                    onClick={() =>
                      setS((v) => ({
                        ...v,
                        weekdays: v.weekdays.map((xs, d) =>
                          d === day ? xs.filter((_, j) => j !== i) : xs,
                        ),
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {intervals.length < 4 && (
                <button
                  type="button"
                  onClick={() =>
                    setS((v) => ({
                      ...v,
                      weekdays: v.weekdays.map((xs, d) =>
                        d === day
                          ? [...xs, { start: "09:00", end: "17:00" }]
                          : xs,
                      ),
                    }))
                  }
                >
                  {w("Add hours", "Tambah waktu")}
                </button>
              )}
            </div>
          ))}
          <h3>{w("Closure dates", "Tarikh tutup")}</h3>
          {s.closures.map((c) => (
            <div className="core-record" key={c.date}>
              <strong>{c.date}</strong>
              <p>{c.reason}</p>
              <button
                type="button"
                onClick={() =>
                  setS((v) => ({
                    ...v,
                    closures: v.closures.filter((x) => x.date !== c.date),
                  }))
                }
              >
                {w("Remove closure", "Buang penutupan")}
              </button>
            </div>
          ))}
          <Field label={w("Closure date", "Tarikh penutupan")}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={w("Closure reason", "Sebab penutupan")}>
            <input
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <button
            type="button"
            disabled={!date || s.closures.some((c) => c.date === date)}
            onClick={() => {
              setS((v) => ({
                ...v,
                closures: [...v.closures, { date, reason }],
              }));
              setDate("");
              setReason("");
            }}
          >
            {w("Add closure", "Tambah penutupan")}
          </button>
          <button className="button button-dark">
            {w("Save schedule", "Simpan jadual")}
          </button>
        </fieldset>
      </form>
    </section>
  );
}
