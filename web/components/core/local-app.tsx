"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HttpCoreClient, CoreError } from "@/lib/core/client";
import type { Session, Bootstrap } from "../../../packages/contracts/src/core";
import { useExperience } from "../experience";
import { WorkspaceChrome, type ActiveScreen } from "./chrome";
import { LocalAuth } from "./auth";
import { CoreContext, Heading, Loading, Notice, useWords } from "./state";
import { Field } from "./field";
import { LocalBookings } from "./bookings";
import { LocalAgentTest } from "./agent-test";
import { BookingSummary } from "./booking-summary";
import { LocalContacts } from "./contacts";
import { LocalAgent } from "./agent";
import { LocalSettings, LocalHours } from "./settings";
export function LocalApp({ screen }: { screen: string }) {
  return ["login", "signup", "forgot", "invite"].includes(screen) ? (
    <LocalAuth mode={screen as "login" | "signup" | "forgot" | "invite"} />
  ) : (
    <LocalWorkspace screen={screen} />
  );
}
function LocalWorkspace({ screen }: { screen: string }) {
  const query = useSearchParams();
  const w = useWords(),
    { href } = useExperience();
  const [session, setSession] = useState<Session>(),
    [orgId, setOrgId] = useState(query.get("workspace") ?? ""),
    [workspace, setWorkspace] = useState<Bootstrap>(),
    [error, setError] = useState<unknown>(),
    [epoch, setEpoch] = useState(0),
    [creating, setCreating] = useState(false),
    [creationError, setCreationError] = useState<unknown>();
  const client = useMemo(() => new HttpCoreClient({ orgId }), [orgId]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const c = new HttpCoreClient({});
        let s: Session;
        try {
          s = await c.execute("session", {});
        } catch (e) {
          if (e instanceof CoreError && e.status === 401) {
            await c.auth("refresh", {});
            s = await c.execute("session", {});
          } else throw e;
        }
        if (alive) {
          setSession(s);
          setError(undefined);
          if (!orgId && s.memberships.length) {
            const id = s.memberships[0].id;
            const url = new URL(location.href);
            url.searchParams.set("workspace", id);
            history.replaceState(null, "", url);
            setOrgId(id);
          }
          if (orgId && s.memberships.some((m) => m.id === orgId)) {
            const updated = await client.execute("bootstrap", { id: orgId });
            if (alive) setWorkspace(updated);
          }
          if (orgId && !s.memberships.some((m) => m.id === orgId)) {
            setWorkspace(undefined);
            setOrgId("");
          }
        }
      } catch (e) {
        if (alive) {
          setError(e);
          if (e instanceof CoreError && [401, 403, 404].includes(e.status))
            setWorkspace(undefined);
        }
      }
    };
    void load();
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", focus);
    const timer = setInterval(focus, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [orgId, epoch]);
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    client
      .execute("bootstrap", { id: orgId })
      .then((v) => {
        if (alive) {
          setWorkspace(v);
          setError(undefined);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e);
          if (e instanceof CoreError && [401, 403, 404].includes(e.status))
            setWorkspace(undefined);
        }
      });
    return () => {
      alive = false;
    };
  }, [client, orgId, epoch]);
  const switchWorkspace = (id: string) => {
    const url = new URL(location.href);
    url.searchParams.set("workspace", id);
    history.replaceState(null, "", url);
    setWorkspace(undefined);
    setOrgId(id);
    setError(undefined);
    setEpoch((v) => v + 1);
  };
  const active = (
    screen === "app"
      ? "calls"
      : ["platform", "selfhost"].includes(screen)
        ? "settings"
        : screen
  ) as ActiveScreen;
  if (error instanceof CoreError && error.status === 401)
    return <LocalAuth mode="login" />;
  return (
    <WorkspaceChrome
      mode="local"
      active={active}
      workspace={{
        name: workspace?.workspace.name,
        location: workspace?.locations[0]?.name,
        complete: !!workspace?.agent?.published_version_id,
        recording: false,
      }}
    >
      <main
        tabIndex={-1}
        id="workspace-content"
        className="product-main core-main"
      >
        {!!error && workspace && <Notice error={error} />}
        {error && !workspace ? (
          <>
            <Notice error={error} />
            <button
              className="button secondary-button"
              onClick={() => setEpoch((v) => v + 1)}
            >
              {w("Retry", "Cuba lagi")}
            </button>
          </>
        ) : !session ? (
          <Loading />
        ) : !session.memberships.length ? (
          <>
            <Heading
              title={w(
                "Make room for your business.",
                "Sediakan ruang untuk perniagaan anda.",
              )}
              description={w(
                "Create your first workspace. Your account and records stay on this computer.",
                "Cipta ruang kerja pertama anda. Akaun dan rekod kekal di komputer ini.",
              )}
            />
            <form
              className="core-panel core-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setCreating(true);
                setCreationError(undefined);
                const f = new FormData(e.currentTarget);
                try {
                  const result = await client.execute("createOrganization", {
                    name: String(f.get("name")),
                    businessType: String(f.get("businessType")),
                    primaryLocationName: String(f.get("branch")),
                  });
                  switchWorkspace(result.orgId);
                } catch (err) {
                  setCreationError(err);
                } finally {
                  setCreating(false);
                }
              }}
            >
              <Notice error={creationError} />
              <Field label={w("Business name", "Nama perniagaan")}>
                <input name="name" required maxLength={120} />
              </Field>
              <Field
                label={w("Business type", "Jenis perniagaan")}
                hint={w(
                  "Describe your business in your own words.",
                  "Terangkan jenis perniagaan anda.",
                )}
              >
                <input name="businessType" required maxLength={80} />
              </Field>
              <Field label={w("Primary branch", "Cawangan utama")}>
                <input name="branch" required maxLength={120} />
              </Field>
              <button disabled={creating} className="button button-dark">
                {w("Create workspace", "Cipta ruang kerja")}
              </button>
            </form>
          </>
        ) : !workspace ? (
          <Loading />
        ) : (
          <CoreContext.Provider
            value={{
              client,
              workspace,
              session,
              epoch,
              refresh: () => setEpoch((v) => v + 1),
              switchWorkspace,
            }}
          >
            <div key={orgId}>
              {screen === "home" ? (
                <>
                  <Heading
                    eyebrow={workspace.workspace.name}
                    title={w(
                      "A clear view of your front desk.",
                      "Gambaran jelas kaunter hadapan anda.",
                    )}
                    description={w(
                      "Your workspace is connected to local data. Configure your agent and build your customer records.",
                      "Ruang kerja anda disambungkan ke data setempat. Sediakan ejen dan rekod pelanggan anda.",
                    )}
                  />
                  <div className="core-overview">
                    <a href={href("/app/contacts")}>
                      <span>{w("Contacts", "Kenalan")}</span>
                      <strong>{workspace.contactCount}</strong>
                      <small>
                        {w(
                          "Real workspace records",
                          "Rekod ruang kerja sebenar",
                        )}
                      </small>
                    </a>
                    <a href={href("/app/agent")}>
                      <span>
                        {w("Agent configuration", "Konfigurasi ejen")}
                      </span>
                      <strong>
                        {workspace.agent?.published_version_id
                          ? w("Published", "Diterbitkan")
                          : w("Draft", "Draf")}
                      </strong>
                      <small>
                        {w(
                          "Channels not connected yet",
                          "Saluran belum disambungkan",
                        )}
                      </small>
                    </a>
                    <a href={href("/app/hours")}>
                      <span>{w("Branches", "Cawangan")}</span>
                      <strong>{workspace.locations.length}</strong>
                      <small>
                        {w(
                          "Hours in your local time zone",
                          "Waktu mengikut zon masa anda",
                        )}
                      </small>
                    </a>
                  </div>
                  <BookingSummary />
                  <section className="core-panel">
                    <h2>
                      {w(
                        "Start with what your team knows.",
                        "Mulakan dengan pengetahuan pasukan anda.",
                      )}
                    </h2>
                    <p>
                      {w(
                        "Add business knowledge, set opening hours and publish an agent configuration. Test answers and manage local bookings now. Voice, WhatsApp, external calendars and payments come later.",
                        "Tambah pengetahuan perniagaan, tetapkan waktu operasi dan terbitkan konfigurasi ejen. Uji jawapan dan urus tempahan setempat sekarang. Suara, WhatsApp, kalendar luar dan pembayaran hadir kemudian.",
                      )}
                    </p>
                    <a className="button button-dark" href={href("/app/setup")}>
                      {w("Continue setup", "Teruskan persediaan")}
                    </a>
                  </section>
                </>
              ) : screen === "bookings" ? (
                <LocalBookings />
              ) : screen === "test" ? (
                <LocalAgentTest />
              ) : screen === "contacts" ? (
                <LocalContacts />
              ) : ["builder", "setup"].includes(screen) ? (
                <LocalAgent setup={screen === "setup"} />
              ) : screen === "settings" ? (
                <LocalSettings />
              ) : screen === "hours" ? (
                <LocalHours />
              ) : (
                <>
                  <Heading
                    title={w(
                      "This channel comes next.",
                      "Saluran ini menyusul nanti.",
                    )}
                    description={w(
                      "Your local workspace includes accounts, teams, contacts, bookings and text-agent tests. This channel needs a later integration phase.",
                      "Fasa 1 menghubungkan akaun, pasukan, konfigurasi ejen dan kenalan. Ciri ini memerlukan fasa integrasi seterusnya.",
                    )}
                  />
                  <section className="core-panel core-unavailable">
                    <span className="remaining-chip">
                      {w("Not connected", "Belum disambungkan")}
                    </span>
                    <h2>
                      {w(
                        "Your core workspace is ready.",
                        "Ruang kerja asas anda sedia.",
                      )}
                    </h2>
                    <p>
                      {w(
                        "No calls, external messages, external calendar writes or payments are sent from local mode. Use the sample preview to explore those flows.",
                        "Tiada panggilan, mesej, perubahan kalendar atau pembayaran dihantar dalam mod setempat. Gunakan pratonton sampel untuk meneroka aliran tersebut.",
                      )}
                    </p>
                    <div className="core-actions">
                      <a className="button button-dark" href={href("/app")}>
                        {w("Go to workspace", "Ke ruang kerja")}
                      </a>
                      <a
                        className="button secondary-button"
                        href={"http://127.0.0.1:4181" + href("/app")}
                      >
                        {w("Open sample preview", "Buka pratonton sampel")}
                      </a>
                    </div>
                  </section>
                </>
              )}
            </div>
          </CoreContext.Provider>
        )}
      </main>
    </WorkspaceChrome>
  );
}
