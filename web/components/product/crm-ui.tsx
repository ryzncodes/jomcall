"use client";
import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { useExperience } from "../experience";
export function CrmDialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const { t, theme } = useExperience();
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target =
              previousFocus.current?.isConnected &&
              previousFocus.current !== document.body
                ? previousFocus.current
                : document.querySelector<HTMLInputElement>(
                    ".admin-content .admin-section-heading button, .crm-search input",
                  );
            target?.focus();
          }}
          className="crm-dialog"
          data-theme={theme}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close
            className="icon-button crm-dialog-close"
            aria-label={t.crm.close}
          >
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function downloadJson(value: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([value], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function dateLabel(
  iso: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  },
) {
  return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    ...options,
  }).format(new Date(iso));
}
