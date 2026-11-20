"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

// A small listbox in place of a native <select>, so the control and its menu
// look the same on iOS, Android and desktop. Keyboard: Enter, Space or the
// arrow keys open it; arrows, Home and End move; Enter or Space picks; Escape
// and Tab close it.
//
// In a form: `name` submits the value like a select would (FormData and
// form.elements both see it), `required` blocks submit while nothing is
// picked, `placeholder` shows while the value matches no option. Without
// `label`, wrap it in a <label> (the button is the first labelable element,
// so the label text opens it and names it).
export function Picker<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className = "",
  placeholder,
  name,
  required = false,
  disabled = false,
  id,
  describedBy,
  "aria-describedby": ariaDescribedBy,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  className?: string;
  placeholder?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
  // Field passes its hint this way to whatever child it wraps.
  "aria-describedby"?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const found = options.findIndex((o) => o.value === value);
  const selected = found < 0 && placeholder === undefined ? 0 : found;
  const shown = selected >= 0 ? options[selected]?.label : placeholder;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const show = (index = Math.max(0, selected)) => {
    if (disabled) return;
    setActive(index);
    setOpen(true);
  };
  const pick = (index: number) => {
    if (options[index]?.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (options[index] && options[index].value !== value)
      onChange(options[index].value);
  };
  const onButtonKey = (e: React.KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className={`picker ${open ? "is-open" : ""} ${className}`} ref={root}>
      <button
        type="button"
        ref={button}
        id={id}
        className={`picker-button ${selected < 0 ? "is-placeholder" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${listId}-list`}
        aria-label={label ? `${label}: ${shown ?? ""}` : undefined}
        aria-describedby={describedBy ?? ariaDescribedBy}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
      >
        <span>{shown}</span>
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={`${listId}-list`}
          ref={list}
          className="picker-list"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === selected}
              aria-disabled={o.disabled || undefined}
              className={i === active ? "is-active" : ""}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span>{o.label}</span>
              {i === selected && <Check size={14} weight="bold" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
      {(name || required) && (
        // Carries the value into the form and lets the browser refuse an
        // empty required picker; hidden from people and from tabbing.
        <input
          className="picker-value"
          name={name}
          value={selected >= 0 ? String(value) : ""}
          required={required}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          onChange={() => undefined}
          onFocus={() => button.current?.focus()}
        />
      )}
    </div>
  );
}
