"use client";
import { Field } from "./field";
import { useExperience } from "../experience";
export function GreetingField({
  value,
  onChange,
  maxLength = 2000,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const { t, mode, locale } = useExperience();
  return (
    <Field
      label={t.product.greeting}
      hint={
        mode === "local"
          ? locale === "ms"
            ? "Kata-kata pembukaan. Pengenalan AI ditetapkan di bawah."
            : "Opening words. Set the required AI introduction below."
          : t.product.greetingHint
      }
    >
      <textarea
        rows={3}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
