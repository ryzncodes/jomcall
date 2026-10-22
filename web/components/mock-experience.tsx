"use client";
import type { Locale } from "@/lib/api/types";
import { Dashboard } from "./product/dashboard";
import { Settings } from "./product/settings";
import { PhoneNumbers } from "./product/phone-numbers";
import { WhatsappSettings } from "./product/whatsapp-settings";
import { Billing } from "./product/billing";
import { Marketing } from "./marketing";
import { Workspace } from "./workspace";
import { ProductProvider } from "./product/provider";
import { GuidedSetup } from "./product/setup";
import { AgentTestPanel } from "./product/test-panel";
import { AgentBuilder } from "./product/builder";
import { Contacts } from "./product/contacts";
import { Bookings } from "./product/bookings";
import { Integrations } from "./product/integrations";
import { CrmProvider } from "./product/crm-provider";
import { Inbox } from "./product/inbox";
import { PublicPages } from "./public-pages";
import { Access } from "./product/access";
import { Outbound } from "./product/outbound";
import { Platform, SelfHost } from "./product/platform";
import { BranchHours } from "./product/branch-hours";

export default function MockExperience({
  screen,
  locale,
}: {
  screen: string;
  locale: Locale;
}) {
  return (
    <ProductProvider locale={locale}>
      <CrmProvider locale={locale}>
        {["pricing", "docs", "privacy", "terms"].includes(screen) ? (
          <PublicPages
            page={screen as "pricing" | "docs" | "privacy" | "terms"}
          />
        ) : ["login", "signup", "forgot", "invite"].includes(screen) ? (
          <Access mode={screen as "login" | "signup" | "forgot" | "invite"} />
        ) : screen === "outbound" ? (
          <Outbound />
        ) : screen === "platform" ? (
          <Platform />
        ) : screen === "selfhost" ? (
          <SelfHost />
        ) : screen === "hours" ? (
          <BranchHours />
        ) : screen === "home" ? (
          <Dashboard />
        ) : screen === "settings" ? (
          <Settings />
        ) : screen === "phones" ? (
          <PhoneNumbers />
        ) : screen === "whatsapp" ? (
          <WhatsappSettings />
        ) : screen === "billing" ? (
          <Billing />
        ) : screen === "contacts" ? (
          <Contacts />
        ) : screen === "bookings" ? (
          <Bookings />
        ) : screen === "integrations" ? (
          <Integrations />
        ) : screen === "builder" ? (
          <AgentBuilder />
        ) : screen === "inbox" ? (
          <Inbox />
        ) : screen === "setup" ? (
          <GuidedSetup />
        ) : screen === "test" ? (
          <AgentTestPanel />
        ) : (
          <Workspace />
        )}
      </CrmProvider>
    </ProductProvider>
  );
}
