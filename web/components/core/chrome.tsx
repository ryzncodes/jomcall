"use client";
import type { FirstRun } from "../../../packages/contracts/src/first-run";
import { stepsFrom } from "@/lib/core/home-rules";
import { useEffect, useMemo, useState } from "react";
import { launchCopy } from "@/lib/launch";
import {
  House,
  GitBranch,
  Clock,
  GearSix,
  Phone,
  WhatsappLogo,
  Wallet,
  Users,
  CalendarBlank,
  PlugsConnected,
  ChatCircleDots,
  Robot,
  Headphones,
  PhoneIncoming,
  ShieldCheck,
  SlidersHorizontal,
  ListChecks,
} from "@phosphor-icons/react";
import { WorkspaceNavigation } from "../product/navigation";
import { Brand, Controls, useExperience } from "../experience";
import { HttpCoreClient } from "@/lib/core/client";
import type { Channels } from "../../../packages/contracts/src/phone";
import type { FollowUpCount } from "../../../packages/contracts/src/follow-up";
import { FOLLOW_UPS_CHANGED } from "@/lib/core/follow-up-rules";
export type ActiveScreen =
  | "home"
  | "follow-ups"
  | "settings"
  | "calls"
  | "setup"
  | "test"
  | "builder"
  | "inbox"
  | "contacts"
  | "bookings"
  | "integrations"
  | "phones"
  | "whatsapp"
  | "billing"
  | "outbound"
  | "hours";
export function WorkspaceChrome({
  active,
  children,
  workspace,
  mode,
  warnings,
  orgId,
}: {
  active: ActiveScreen;
  children: React.ReactNode;
  workspace: {
    name?: string;
    location?: string;
    complete?: boolean;
    recording?: boolean;
  };
  mode: "mock" | "local";
  warnings?: React.ReactNode;
  orgId?: string;
}) {
  const { t, href, locale, mode: runMode } = useExperience(),
    p = t.product;
  const hosted = runMode === "hosted";
  // Local and hosted modes hide channel pages that are not connected. While
  // the read is loading or failed those entries stay out (fail closed).
  // Mock mode shows every entry, as before.
  const [channels, setChannels] = useState<Channels>();
  const channelClient = useMemo(
    () => (mode === "local" && orgId ? new HttpCoreClient({ orgId }) : undefined),
    [mode, orgId],
  );
  // The getting-started link: owners and admins only (staff get 403 and
  // see nothing), read with the channels and on the same focus.
  const [firstRun, setFirstRun] = useState<FirstRun>();
  // The open follow-ups, for every role; read on focus and after any
  // follow-up command on this page. A failed read shows no number.
  const [followUps, setFollowUps] = useState<FollowUpCount>();
  useEffect(() => {
    setChannels(undefined);
    setFirstRun(undefined);
    setFollowUps(undefined);
    if (!channelClient) return;
    let alive = true;
    const count = () =>
      void channelClient
        .execute("followUpCount", {})
        .then((v) => alive && setFollowUps(v))
        .catch(() => alive && setFollowUps(undefined));
    const load = () => {
      count();
      void channelClient
        .execute("firstRun", {})
        .then((v) => alive && setFirstRun(v))
        .catch(() => alive && setFirstRun(undefined));
      return channelClient
        .execute("channels", {})
        .then((v) => alive && setChannels(v))
        .catch(() => alive && setChannels(undefined));
    };
    void load();
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", focus);
    window.addEventListener(FOLLOW_UPS_CHANGED, count);
    return () => {
      alive = false;
      window.removeEventListener("focus", focus);
      window.removeEventListener(FOLLOW_UPS_CHANGED, count);
    };
  }, [channelClient]);
  const all = [
    { key: "home", href: "/app", label: t.admin.nav, Icon: House },
    {
      key: "follow-ups",
      href: "/app/follow-ups",
      label: t.followUps.nav,
      Icon: ListChecks,
      count: followUps?.open,
    },
    {
      key: "inbox",
      href: "/app/inbox",
      label: t.inbox.nav,
      Icon: ChatCircleDots,
    },
    {
      key: "contacts",
      href: "/app/contacts",
      label: t.crm.contacts,
      Icon: Users,
    },
    {
      key: "bookings",
      href: "/app/bookings",
      label: t.crm.bookings,
      Icon: CalendarBlank,
    },
    {
      key: "integrations",
      href: "/app/integrations",
      label: t.crm.integrations,
      Icon: PlugsConnected,
    },
    {
      key: "outbound",
      href: "/app/outbound",
      label: t.remaining.outbound,
      Icon: GitBranch,
    },
    {
      key: "hours",
      href: "/app/hours",
      label: t.remaining.branchHours,
      Icon: Clock,
    },
    {
      key: "phones",
      href: "/app/phone-numbers",
      label: t.services.phones,
      Icon: Phone,
    },
    {
      key: "whatsapp",
      href: "/app/whatsapp",
      label: t.services.whatsapp,
      Icon: WhatsappLogo,
    },
    {
      key: "billing",
      href: "/app/billing",
      label: t.services.billing,
      Icon: Wallet,
    },
    { key: "builder", href: "/app/agent", label: t.builder.nav, Icon: Robot },
    { key: "calls", href: "/app/calls", label: t.calls, Icon: PhoneIncoming },
    {
      key: "setup",
      href: "/app/setup",
      label: p.setup,
      Icon: SlidersHorizontal,
    },
    { key: "test", href: "/app/test", label: p.testLab, Icon: Headphones },
    {
      key: "settings",
      href: "/app/settings",
      label: t.admin.settings,
      Icon: GearSix,
    },
  ];
  const hidden: string[] =
    mode === "local"
      ? [
          ...(channels?.phone ? [] : ["phones"]),
          ...(channels?.whatsapp ? [] : ["whatsapp"]),
          // The inbox holds WhatsApp chats only for now: it shows once this
          // workspace has a connected WhatsApp number, not just the service.
          ...(channels?.live?.whatsapp ? [] : ["inbox"]),
          ...(channels?.integrations ? [] : ["integrations"]),
          // Follow-up (outbound) is not built for real workspaces yet.
          ...(hosted ? ["outbound"] : []),
          // Opening hours live on the agent page here; mock keeps its screen.
          "hours",
          ...(workspace.complete && active !== "setup" ? ["setup"] : []),
        ]
      : // The follow-up queue holds real calls and chats only.
        ["follow-ups"];
  const navigation = all.filter((item) => !hidden.includes(item.key));
  const startSteps = firstRun ? stepsFrom({ manager: true, ...firstRun }) : undefined;
  const startDone = startSteps?.filter((x) => x.state === "done").length ?? 0;
  // A real workspace never shows the sample business's name, even while its
  // own name is loading; the mock preview keeps the sample.
  const shownName =
    workspace.name ||
    (mode === "mock" ? t.workspace : locale === "ms" ? "Ruang kerja" : "Workspace");
  return (
    <div className="workspace product-workspace">
      <a className="skip-link" href="#workspace-content">
        {t.skip}
      </a>
      <aside className="workspace-sidebar">
        <Brand />
        <div className="workspace-switch">
          <div className="workspace-avatar" aria-hidden="true">
            {(Array.from(shownName.trim())[0] ?? "?").toLocaleUpperCase()}
          </div>
          <div>
            <strong>{shownName}</strong>
            <small>{workspace.location || "—"}</small>
          </div>
        </div>
        {startSteps && startDone < startSteps.length && (
          <a className="sidebar-start" href={href("/app")}>
            {locale === "ms"
              ? `Bermula: ${startDone} daripada ${startSteps.length}`
              : `Getting started: ${startDone} of ${startSteps.length}`}
          </a>
        )}
        <WorkspaceNavigation
          active={active}
          entries={navigation}
          setupComplete={!!workspace.complete}
        />
        <div className="sidebar-bottom">
          <div className="sidebar-disclosure">
            <ShieldCheck size={20} />
            <p>
              {mode === "local" && !hosted
                ? locale === "ms"
                  ? "Pengenalan AI wajib sebelum diterbitkan"
                  : "AI introduction required before publishing"
                : p.disclosureAlways}
              <strong>
                {mode === "local" && !hosted
                  ? locale === "ms"
                    ? "Panggilan belum disambungkan"
                    : "Calls not connected"
                  : workspace.recording === false
                    ? p.recordingOff
                    : t.enabled}
              </strong>
            </p>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <span>
            {mode === "local"
              ? hosted
                ? locale === "ms"
                  ? "Ruang kerja"
                  : "Workspace"
                : locale === "ms"
                  ? "Ruang kerja setempat"
                  : "Local workspace"
              : p.preview}
          </span>
          <div>
            <span className="preview-badge">
              {mode === "local"
                ? hosted
                  ? locale === "ms"
                    ? launchCopy.badge[1]
                    : launchCopy.badge[0]
                  : locale === "ms"
                    ? "Data setempat"
                    : "Local data"
                : t.sampleBadge}
            </span>
            <Controls />
          </div>
        </header>
        {warnings}
        {children}
      </div>
    </div>
  );
}
