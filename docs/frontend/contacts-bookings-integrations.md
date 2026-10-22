# Contacts, bookings and integrations preview

Built on 15 October 2026, following `screens.md`. All records and external operations are fictional. No accounts, credentials or backend are required.

## Routes and behavior

- `/app/contacts`: searchable directory, consent/DNC filters, profile editing, preferred language and relationship stage, append-only consent history, linked appointments and recent conversation events. Export includes the contact, conversation events, consent records, calls and bookings. Confirmed local deletion removes all of those records together.
- `/app/bookings`: month calendar and daily agenda, contact/status filters, cross-links to profiles, appointment creation, confirmation, rescheduling and cancellation. Times are interpreted and displayed in `Asia/Kuala_Lumpur`. Bookings validate future dates, weekly business hours, manual closures, conflicts and the agent's buffer. Cancellation retains history and adds a contact timeline entry without sending a message.
- `/app/integrations`: Google Calendar, Cal.com, Google Sheets, Facebook lead forms, TikTok lead forms and webhooks. Each has connect/disconnect and health states. Calendar failure/reconnection affects setup, agent testing and booking confirmation. Lead imports add fictional contacts and inbox threads without opt-in or an open WhatsApp service window. Sheets/webhook runs produce downloadable sample results; nothing is sent externally.

## Connected state and migration

`web/lib/api/crm.ts` owns typed bookings, consent records, connectors and historical calls around the existing inbox contact model. `CrmProvider` persists one snapshot in `jomcall-preview-crm-v1`. Contacts, inbox and the call log share profile/DNC state; bookings add timeline entries to the same contact. Cross-tab storage events refresh these records. Setup/calendar changes also refresh other open app tabs.

The first CRM load imports the previous `jomcall-preview-inbox-v1` contacts and events. A successful save removes that legacy copy, so deletion cannot resurrect it on the next load. Existing setup/builder drafts remain under `jomcall-preview-setup-v1`. Malformed CRM data is preserved and reported instead of silently overwritten. Denied storage falls back to the current tab with a visible warning; those edits cannot persist.

Call-log fixtures are now mapped to the canonical inbox contact IDs. The public marketing example remains a separate fictional demo. Inbox call simulations remain timeline events; they are not additional billable call-log records.

One calendar can be connected at a time. Switching requires a clear confirmation and retains each confirmed booking's original provider. Reconnect that provider before rescheduling its confirmed bookings. Requests can be collected without a calendar; confirmation requires both a connected calendar and calendar booking mode in Agent builder. Existing requests do not silently become confirmed after connection. Browser call/chat tests remain rehearsals and never create appointments.

## Design

The existing paper/forest palette and local Public Sans, Manrope and IBM Plex Mono continue into three working layouts: a directory/profile desk, a month calendar with daily agenda, and provider cards grouped by scheduling, operations and lead sources. Mobile profiles use a focused drill-down; navigation scrolls the active destination into view. Dialogs use Radix focus management, explicit destructive confirmation and visible labels. BM and English copy live in the existing dictionaries.

## Verification

- Production build and TypeScript checks pass for all routes.
- Screenshots and axe checks cover directory, profile, calendar/agenda, integrations and booking form at 390, 768 and 1440 px, in English/BM and light/dark: 60 combinations, no detected horizontal overflow, axe WCAG A/AA violations or runtime errors.
- Connected browser journey verifies profile editing into inbox/call log, consent audit, calendar setup state, confirmed booking creation, conflict/buffer and hours validation, rescheduling, calendar failure gate, cancellation, reconnection/switching, lead import, sample sync/event results, export download and persistent cascading deletion.
- Existing inbox journey rerun against the shared store: replies, failed retry, ambiguous delivery reconciliation, no duplicate sends, DNC, internal notes, call permission, takeover, templates, resolve/reopen, persistence and mobile focus/navigation pass.
- Additional checks cover consent/edit/delete/switch/error/empty states, long BM-layout names, legacy migration, empty-workspace persistence, cross-tab contact/calendar updates, storage denial and malformed-data preservation. Evidence: `screenshots/operations/`; local scripts/results remain ignored under `output/playwright/operations/`.

## Boundaries

This is a local prototype, not a production CRM or PDPA implementation. It has no authentication, access controls, backend retention, live OAuth, provider availability, automatic calendar synchronization, real contact import, real message delivery or payment operations. Multi-tab refresh is not a distributed concurrency guarantee. Availability uses local sample appointments and agent hours, with no holiday feed or external calendars. Real Android/4G Core Web Vitals, CI accessibility wiring and the component-state gallery remain outstanding from the broader frontend plan. No dependencies were added.
