import { localePath, type PublicLocale } from "@/lib/site";
import {
  LEGAL_EFFECTIVE_DATE,
  OPERATOR,
  PRIVACY_CONTACT_EMAIL,
} from "@/lib/operator";
import { legalCopy } from "@/messages/legal";
import { common } from "@/content/public/common";

// Fills operator facts into legal text. Facts live only in lib/operator.ts.
export function fillOperator(text: string): string {
  return text
    .replaceAll("{name}", OPERATOR.legalName)
    .replaceAll("{reg}", OPERATOR.registrationNumber)
    .replaceAll("{address}", OPERATOR.address)
    .replaceAll("{email}", PRIVACY_CONTACT_EMAIL)
    .replaceAll("{date}", LEGAL_EFFECTIVE_DATE);
}

// The operator's identity, shown in every public footer: the same facts as
// the app's footer, rendered on the server with no app context.
export function OperatorDetails({ locale }: { locale: PublicLocale }) {
  const f = legalCopy[locale].footer;
  const t = common[locale];
  return (
    <div className="operator t-small">
      <p>
        <strong>{fillOperator(f.product)}</strong>
        <span>{fillOperator(f.registration)}</span>
        <span>{OPERATOR.address}</span>
      </p>
      <p>
        <a href={localePath("privacy", locale)}>{t.pages.privacy}</a>
        <a href={localePath("terms", locale)}>{t.pages.terms}</a>
        <a href={OPERATOR.repositoryUrl} rel="noopener noreferrer">
          {f.source}
        </a>
        <span>{f.licence}</span>
      </p>
    </div>
  );
}
