"use client";
import { useSignedIn } from "@/components/signed-in";
import { HOSTED } from "@/lib/hosted";
import type { PublicLocale } from "@/lib/site";
import { AppLink } from "./cta";

// The button on a plan card: sign-up for a visitor, the Billing page for a
// signed-in owner (a plan is chosen there, not by signing up again). Until
// the session check answers it shows the visitor's link, which works without
// script; both labels share one grid cell so the button never changes width.
export function PlanButton({
  locale,
  getStarted,
  choose,
  primary,
}: {
  locale: PublicLocale;
  getStarted: string;
  choose: string;
  primary: boolean;
}) {
  const email = useSignedIn(HOSTED);
  const signedIn = Boolean(email);
  const className = `btn btn-block ${primary ? "btn-primary" : "btn-secondary"}`;
  return (
    <AppLink path={signedIn ? "/app/billing" : "/signup"} locale={locale} className={className}>
      <span className="cta-label">
        <span>{signedIn ? choose : getStarted}</span>
        <span className="cta-reserve" aria-hidden="true">
          {signedIn ? getStarted : choose}
        </span>
      </span>
    </AppLink>
  );
}
