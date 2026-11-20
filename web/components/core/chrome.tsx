"use client";
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
  ArrowLeft,
  ChatCircleDots,
  Robot,
  Headphones,
  PhoneIncoming,
  ShieldCheck,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { WorkspaceNavigation } from "../product/navigation";
import { Brand, Controls, useExperience } from "../experience";
import { HttpCoreClient } from "@/lib/core/client";
import type { Channels } from "../../../packages/contracts/src/phone";
export type ActiveScreen =
  | "home"
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
  useEffect(() => {
    setChannels(undefined);
    if (!channelClient) return;
    let alive = true;
    const load = () =>
      channelClient
        .execute("channels", {})
        .then((v) => alive && setChannels(v))
        .catch(() => alive && setChannels(undefined));
    void load();
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      window.removeEventListener("focus", focus);
    };
  }, [channelClient]);
  const all = [
    { key: "home", href: "/app", label: t.admin.nav, Icon: House },
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
          // The inbox holds WhatsApp chats only for now, so it follows the
          // WhatsApp switch.
          ...(channels?.whatsapp ? [] : ["inbox"]),
          ...(channels?.integrations ? [] : ["integrations"]),
          // Opening hours live on the agent page here; mock keeps its screen.
          "hours",
          ...(workspace.complete && active !== "setup" ? ["setup"] : []),
        ]
      : [];
  const navigation = all.filter((item) => !hidden.includes(item.key));
  return (
    <div className="workspace product-workspace">
      <a className="skip-link" href="#workspace-content">
        {t.skip}
      </a>
      <aside className="workspace-sidebar">
        <Brand />
        <div className="workspace-switch">
          <div className="workspace-avatar">C</div>
          <div>
            <strong>{workspace.name || t.workspace}</strong>
            <small>{workspace.location || "—"}</small>
          </div>
        </div>
        <WorkspaceNavigation
          active={active}
          entries={navigation}
          setupComplete={!!workspace.complete}
        />
        <div className="sidebar-bottom">
          <div className="sidebar-disclosure">
            <ShieldCheck size={20} />
            <p>
              {mode === "local"
                ? locale === "ms"
                  ? "Pengenalan AI wajib sebelum diterbitkan"
                  : "AI introduction required before publishing"
                : p.disclosureAlways}
              <strong>
                {mode === "local"
                  ? locale === "ms"
                    ? "Panggilan belum disambungkan"
                    : "Calls not connected"
                  : workspace.recording === false
                    ? p.recordingOff
                    : t.enabled}
              </strong>
            </p>
          </div>
          <a href={href("/")}>
            <ArrowLeft size={17} />
            {t.home}
          </a>
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
