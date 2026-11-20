"use client";
import { Picker } from "@/components/picker";
import { HOSTED } from "@/lib/hosted";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { HttpCoreClient, CoreError } from "@/lib/core/client";
import type { Session, Bootstrap } from "../../../packages/contracts/src/core";
import { useExperience } from "../experience";
import { WorkspaceChrome, type ActiveScreen } from "./chrome";
import { LocalAuth, OpenLink } from "./auth";
import { CoreContext, Heading, Loading, Notice, useWords } from "./state";
import { Field } from "./field";
import { pendingInvite } from "@/lib/core/invite";
import { LocalBookings } from "./bookings";
import { LocalHome } from "./home/home";
import { LocalAgentTest } from "./agent-test";
import { LocalContacts } from "./contacts";
import { LocalAgent } from "./agent/index";
import { LocalSettings } from "./settings";
import { LocalBilling } from "./billing";
import { LocalPhoneNumbers, LocalCalls } from "./phone";
import { LocalWhatsApp } from "./whatsapp";
import { LocalInbox } from "./inbox";
import {
  businessTypeText,
  businessTypes,
} from "../../../packages/domain/src/setup/business-types";
// The guided setup flow exists only in the local and hosted builds. The mode
// is a build-time constant, so the mock bundle drops this import.
const SetupFlow =
  process.env.NEXT_PUBLIC_JOMCALL_MODE === "local" ||
  process.env.NEXT_PUBLIC_JOMCALL_MODE === "hosted"
    ? dynamic(() => import("./setup/flow").then((m) => m.SetupFlow))
    : null;
export function LocalApp({ screen }: { screen: string }) {
  return screen === "link" ? (
    <OpenLink />
  ) : ["login", "signup", "forgot", "invite"].includes(screen) ? (
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
    [creationError, setCreationError] = useState<unknown>(),
    [typeId, setTypeId] = useState("");
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
        : screen === "hours"
          ? "builder"
          : screen
  ) as ActiveScreen;
  if (error instanceof CoreError && error.status === 401)
    return <LocalAuth mode="login" />;
  return (
    <WorkspaceChrome
      mode="local"
      orgId={orgId}
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
                HOSTED
                  ? "Create your first workspace for your business."
                  : "Create your first workspace. Your account and records stay on this computer.",
                HOSTED
                  ? "Cipta ruang kerja pertama untuk perniagaan anda."
                  : "Cipta ruang kerja pertama anda. Akaun dan rekod kekal di komputer ini.",
              )}
            />
            <InviteWaiting />
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
                    businessType: businessTypeText(
                      String(f.get("businessType")),
                      String(f.get("businessTypeOther") ?? ""),
                    ),
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
                  "Pick the closest match. Setup asks questions for this type.",
                  "Pilih yang paling hampir. Persediaan akan bertanya soalan untuk jenis ini.",
                )}
              >
                {/* The English label is stored (or, for "Something else", the
                    owner's own words), so setup can preselect the type. */}
                <Picker
                  name="businessType"
                  required
                  value={typeId}
                  onChange={setTypeId}
                  placeholder={w("Choose one", "Pilih satu")}
                  options={businessTypes.map((t) => ({
                    value: t.id,
                    label: w(t.en, t.ms),
                  }))}
                />
              </Field>
              {typeId === "other" && (
                <Field
                  label={w("What kind of business?", "Perniagaan jenis apa?")}
                >
                  <input
                    name="businessTypeOther"
                    required
                    maxLength={80}
                    pattern=".*\S.*"
                  />
                </Field>
              )}
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
                <LocalHome />
              ) : screen === "bookings" ? (
                <LocalBookings />
              ) : screen === "test" ? (
                <LocalAgentTest />
              ) : screen === "contacts" ? (
                <LocalContacts />
              ) : screen === "setup" ? (
                SetupFlow ? (
                  <SetupFlow />
                ) : null
              ) : screen === "builder" ? (
                <LocalAgent setup={false} />
              ) : screen === "settings" ? (
                <LocalSettings />
              ) : screen === "hours" ? (
                <LocalAgent setup={false} />
              ) : screen === "billing" ? (
                <LocalBilling />
              ) : screen === "phones" ? (
                <LocalPhoneNumbers />
              ) : screen === "app" ? (
                <LocalCalls />
              ) : screen === "whatsapp" ? (
                <LocalWhatsApp />
              ) : screen === "inbox" ? (
                <LocalInbox />
              ) : (
                <>
                  <Heading
                    title={w(
                      "This channel comes next.",
                      "Saluran ini menyusul nanti.",
                    )}
                    description={w(
                      HOSTED
                        ? "Your workspace includes accounts, teams, contacts, bookings and agent tests. This channel is not connected yet."
                        : "Your local workspace includes accounts, teams, contacts, bookings and text-agent tests. This channel needs a later integration phase.",
                      HOSTED
                        ? "Ruang kerja anda merangkumi akaun, pasukan, kenalan, tempahan dan ujian ejen. Saluran ini belum disambungkan."
                        : "Fasa 1 menghubungkan akaun, pasukan, konfigurasi ejen dan kenalan. Ciri ini memerlukan fasa integrasi seterusnya.",
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
                        HOSTED
                          ? "This channel is not connected yet. Nothing is sent to an outside service from this page."
                          : "No calls, external messages, external calendar writes or payments are sent from local mode. Use the sample preview to explore those flows.",
                        HOSTED
                          ? "Saluran ini belum disambungkan. Tiada apa-apa dihantar ke perkhidmatan luar dari halaman ini."
                          : "Tiada panggilan, mesej, perubahan kalendar atau pembayaran dihantar dalam mod setempat. Gunakan pratonton sampel untuk meneroka aliran tersebut.",
                      )}
                    </p>
                    <div className="core-actions">
                      <a className="button button-dark" href={href("/app")}>
                        {w("Go to workspace", "Ke ruang kerja")}
                      </a>
                      {!HOSTED && (
                        <a
                          className="button secondary-button"
                          href={"http://127.0.0.1:4181" + href("/app")}
                        >
                          {w("Open sample preview", "Buka pratonton sampel")}
                        </a>
                      )}
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

// Shown to a signed-in person with no workspace. Someone invited to a team
// should join it, not create a business of their own.
function InviteWaiting() {
  const w = useWords(),
    { href } = useExperience();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(pendingInvite()), []);
  return token ? (
    <div className="core-panel core-invite-waiting" role="status">
      <strong>
        {w(
          "You have an invitation waiting.",
          "Anda ada jemputan yang menunggu.",
        )}
      </strong>
      <p>
        {w(
          "Join your team instead of creating a new workspace.",
          "Sertai pasukan anda dan bukannya mencipta ruang kerja baharu.",
        )}
      </p>
      <a className="button button-dark" href={href("/invite?token=" + token)}>
        {w("Open invitation", "Buka jemputan")}
      </a>
    </div>
  ) : (
    <p className="core-hint">
      {w(
        "Invited to a team? Open the link in your invitation email instead.",
        "Dijemput ke satu pasukan? Buka pautan dalam e-mel jemputan anda.",
      )}
    </p>
  );
}
