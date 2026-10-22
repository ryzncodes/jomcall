"use client";
import { Field } from "./field";
import { useExperience } from "../experience";
export function ContactNameField({
  value,
  onChange,
  name = "name",
}: {
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
}) {
  const { t } = useExperience();
  return (
    <Field label={t.crm.name}>
      <input
        name={name}
        required
        maxLength={120}
        {...(onChange
          ? {
              value: value ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                onChange(e.target.value),
            }
          : { defaultValue: value })}
      />
    </Field>
  );
}
