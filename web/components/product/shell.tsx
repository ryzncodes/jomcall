"use client";
import { WorkspaceChrome, type ActiveScreen } from "../core/chrome";
import { useProduct } from "./provider";
import { useCrm } from "./crm-provider";
import { useExperience } from "../experience";
export function AppShell({
  active,
  children,
}: {
  active: ActiveScreen;
  children: React.ReactNode;
}) {
  const { draft, storage } = useProduct(),
    crm = useCrm(),
    { t } = useExperience();
  return (
    <WorkspaceChrome
      active={active}
      mode="mock"
      workspace={{
        name: draft?.organization.name,
        location: draft?.location.name,
        complete: !!draft?.completed,
        recording: draft?.agent.recording_enabled,
      }}
      warnings={
        <>
          {(storage === "unavailable" || !crm.saved) && (
            <p className="storage-warning" role="alert">
              {crm.error ? t.crm.loadError : t.product.storageWarning}
            </p>
          )}
          {draft?.extensions.platform.suspended.includes(
            draft.organization.id,
          ) && <p className="storage-warning">{t.remaining.reasons.paused}</p>}
        </>
      }
    >
      {children}
    </WorkspaceChrome>
  );
}
