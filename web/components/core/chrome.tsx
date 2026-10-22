"use client";
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
}) {
  const { t, href, locale } = useExperience(),
    p = t.product;
  const navigation = [
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
              ? locale === "ms"
                ? "Ruang kerja setempat"
                : "Local workspace"
              : p.preview}
          </span>
          <div>
            <span className="preview-badge">
              {mode === "local"
                ? locale === "ms"
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
