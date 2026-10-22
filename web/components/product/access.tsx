"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  CheckCircle,
  Envelope,
  ArrowLeft,
} from "@phosphor-icons/react";
import { useExperience } from "../experience";
import { PublicFrame } from "../public-pages";
import { useProduct } from "./provider";
import { Field } from "./setup";
export function Access({
  mode,
}: {
  mode: "login" | "signup" | "forgot" | "invite";
}) {
  const { t, href } = useExperience(),
    p = t.remaining,
    { draft: d, update } = useProduct();
  const [email, setEmail] = useState("owner@example.invalid"),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [notice, setNotice] = useState(""),
    [done, setDone] = useState(false),
    [recover, setRecover] = useState(false),
    [member, setMember] = useState("");
  const active = d?.admin.members.find(
    (m) => m.id === d.extensions.session?.member_id && m.status === "active",
  );
  const signIn = (google = false) => {
    if (!d) return;
    const chosen = google
      ? d.admin.members.find((m) => m.role === "owner" && m.status === "active")
      : d.admin.members.find(
          (m) =>
            m.email.toLowerCase() === email.trim().toLowerCase() &&
            m.status === "active",
        );
    if (mode === "signup" && !google) {
      if (
        d.admin.members.some(
          (m) => m.email.toLowerCase() === email.trim().toLowerCase(),
        )
      ) {
        setNotice(p.authError);
        return;
      }
      const id = crypto.randomUUID();
      update((v) => ({
        ...v,
        admin: {
          ...v.admin,
          members: [
            ...v.admin.members,
            {
              id,
              org_id: v.organization.id,
              name: name.trim(),
              email: email.trim(),
              role: "admin",
              status: "active",
            },
          ],
        },
        extensions: {
          ...v.extensions,
          session: { member_id: id, method: "email" },
        },
      }));
    } else {
      if (!chosen) {
        setNotice(p.authError);
        return;
      }
      update((v) => ({
        ...v,
        extensions: {
          ...v.extensions,
          session: {
            member_id: chosen.id,
            method: google ? "google" : "email",
          },
        },
      }));
    }
    setPassword("");
    setDone(true);
    setNotice(p.authDone);
  };
  return (
    <PublicFrame>
      <main tabIndex={-1} id="content" className="access-layout">
        <section className="access-story">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <h1>{p.authTitle}</h1>
          <p>{p.authIntro}</p>
          <div className="access-lines" aria-hidden="true">
            {Array.from({ length: 25 }, (_, i) => (
              <i
                key={i}
                style={{
                  height: `${24 + Math.sin(i * 0.8) * 15 + (i % 4) * 10}%`,
                }}
              />
            ))}
          </div>
          <small>{p.authHint}</small>
        </section>
        <section className="access-form">
          <span className="remaining-chip">{p.previewOnly}</span>
          <h2>{p[mode]}</h2>
          {d ? (
            <>
              {done ? (
                <div className="access-success">
                  <CheckCircle size={42} />
                  <h3>{p.authDone}</h3>
                  <a
                    className="button button-dark"
                    href={href(mode === "signup" ? "/app/setup" : "/app")}
                  >
                    {p.authEnter}
                    <ArrowUpRight size={18} />
                  </a>
                </div>
              ) : mode === "invite" ? (
                <>
                  <p>{p.inviteHint}</p>
                  {d.admin.members.some((m) => m.status === "invited") ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          !d.admin.members.some(
                            (m) => m.id === member && m.status === "invited",
                          )
                        )
                          return;
                        update((v) => ({
                          ...v,
                          admin: {
                            ...v.admin,
                            members: v.admin.members.map((m) =>
                              m.id === member ? { ...m, status: "active" } : m,
                            ),
                          },
                          extensions: {
                            ...v.extensions,
                            session: { member_id: member, method: "email" },
                          },
                        }));
                        setDone(true);
                      }}
                    >
                      <Field label={p.email}>
                        <select
                          required
                          value={member}
                          onChange={(e) => setMember(e.target.value)}
                        >
                          <option value="">—</option>
                          {d.admin.members
                            .filter((m) => m.status === "invited")
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.email} · {t.admin[m.role]}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <button className="button button-dark">
                        {p.acceptInvite}
                      </button>
                    </form>
                  ) : (
                    <p>{p.noInvites}</p>
                  )}
                  <a
                    className="text-link"
                    href={href("/app/settings?section=team")}
                  >
                    {p.manageTeam}
                    <ArrowUpRight size={18} />
                  </a>
                </>
              ) : mode === "forgot" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (recover) {
                      setPassword("");
                      setRecover(false);
                      setNotice(p.saved);
                    } else {
                      setRecover(true);
                      setNotice(p.recoveryDone);
                    }
                  }}
                >
                  <Field label={p.email}>
                    <input
                      type="email"
                      value={email}
                      required
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  {recover && (
                    <Field label={p.password} hint={p.passwordHint}>
                      <input
                        type="password"
                        minLength={8}
                        maxLength={128}
                        required
                        value={password}
                        autoComplete="off"
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                  )}
                  <button className="button button-dark">
                    <Envelope size={18} />
                    {recover ? p.newPassword : p.recoverySubmit}
                  </button>
                  <a className="text-link" href={href("/login")}>
                    <ArrowLeft size={17} />
                    {p.login}
                  </a>
                </form>
              ) : (
                <>
                  <button
                    className="button secondary-button google-preview"
                    onClick={() => signIn(true)}
                  >
                    <span aria-hidden="true">G</span>
                    {p.google}
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      signIn();
                    }}
                  >
                    {mode === "signup" && (
                      <Field label={p.name}>
                        <input
                          required
                          maxLength={100}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Field>
                    )}
                    <Field label={p.email}>
                      <input
                        required
                        type="email"
                        maxLength={150}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                    <Field label={p.password} hint={p.passwordHint}>
                      <input
                        required
                        type="password"
                        minLength={8}
                        maxLength={128}
                        autoComplete="off"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                    <button className="button button-dark">
                      {p.authSubmit}
                      <ArrowUpRight size={18} />
                    </button>
                  </form>
                  <div className="access-links">
                    <a href={href(mode === "login" ? "/signup" : "/login")}>
                      {mode === "login" ? p.signup : p.login}
                    </a>
                    <a href={href("/forgot-password")}>{p.forgot}</a>
                  </div>
                </>
              )}
              {active && (
                <div className="session-strip">
                  <small>{p.signedAs}</small>
                  <strong>
                    {active.name} · {t.admin[active.role]}
                  </strong>
                  <button
                    className="text-link"
                    onClick={() => {
                      update((v) => ({
                        ...v,
                        extensions: { ...v.extensions, session: null },
                      }));
                      setDone(false);
                      setNotice("");
                    }}
                  >
                    {p.signout}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>{t.product.loading}</p>
          )}
          <p className="remaining-notice" role="status">
            {notice}
          </p>
        </section>
      </main>
    </PublicFrame>
  );
}
