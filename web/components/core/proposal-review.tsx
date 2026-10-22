"use client";
import { useState } from "react";
import type { Proposal } from "../../../packages/contracts/src/agent-test";
import { useCore, useWords, useResource, useAction, Notice } from "./state";
import { Field } from "./field";
import { useExperience } from "../experience";
import { bookingTime } from "./booking-calendar";
export function ProposalReview({
  proposal,
  sessionId,
  locationId,
  contactId,
  ready,
}: {
  proposal: Proposal;
  sessionId: string;
  locationId: string;
  contactId: string | null;
  ready: boolean;
}) {
  const { client, workspace } = useCore(),
    w = useWords(),
    { href, locale } = useExperience(),
    a = useAction();
  const [review, setReview] = useState(false),
    [contact, setContact] = useState(contactId ?? ""),
    [search, setSearch] = useState("");
  const contacts = useResource(
    () => client.execute("listContacts", { search, limit: 25 }),
    "proposal-contacts|" + search,
  );
  const bound = useResource(
    () =>
      contactId
        ? client.execute("getContact", { id: contactId })
        : Promise.resolve(null),
    "proposal-bound|" + contactId,
  );
  const resources = useResource(
    () => client.execute("bookingResources", { locationId }),
    "proposal-resources|" + locationId,
  );
  const resource =
    proposal.kind === "booking"
      ? resources.data?.find(
          (r) => r.id === proposal.details.resourceId && r.active,
        )
      : undefined;
  const branch = workspace.locations.find(
    (l) => l.id === resource?.location_id,
  );
  const resourceReady = Boolean(resource && branch && !resources.error);
  return (
    <section className="core-proposal">
      <span className="remaining-chip">
        {w("Test proposal", "Cadangan ujian")}
      </span>
      <h3>
        {proposal.kind === "booking"
          ? proposal.details.title
          : proposal.kind === "message"
            ? w("Take a message", "Ambil pesanan")
            : w("Ask your team to help", "Minta bantuan pasukan")}
      </h3>
      <p>
        {proposal.kind === "booking"
          ? bookingTime(proposal.details.startAt, locale, true)
          : proposal.kind === "message"
            ? proposal.details.text
            : proposal.details.reason}
      </p>
      {proposal.kind === "booking" &&
        (resource && branch ? (
          <dl className="core-test-facts">
            <dt>{w("Resource", "Sumber")}</dt>
            <dd>{resource.name}</dd>
            <dt>{w("Branch", "Cawangan")}</dt>
            <dd>{branch.name}</dd>
            <dt>{w("Duration", "Tempoh")}</dt>
            <dd>
              {resource.duration_minutes} {w("minutes", "minit")}
            </dd>
            <dt>{w("Ends", "Tamat")}</dt>
            <dd>
              {bookingTime(
                new Date(
                  Date.parse(proposal.details.startAt) +
                    resource.duration_minutes * 60000,
                ).toISOString(),
                locale,
                true,
              )}{" "}
              · Asia/Kuala_Lumpur
            </dd>
          </dl>
        ) : (
          <p>
            {w(
              "Resource unavailable. Refresh its details before applying.",
              "Sumber tiada. Muat semula butiran sebelum memohon.",
            )}
          </p>
        ))}
      <Notice error={a.error ?? bound.error ?? resources.error} />
      {proposal.applied_booking_id ? (
        <a
          className="button secondary-button"
          href={
            href("/app/bookings") + "&booking=" + proposal.applied_booking_id
          }
        >
          {w("View booking request", "Lihat permohonan tempahan")}
        </a>
      ) : proposal.kind === "booking" ? (
        <>
          {!review ? (
            <button
              className="button secondary-button"
              disabled={!ready || !resourceReady}
              onClick={() => setReview(true)}
            >
              {w("Review booking proposal", "Semak cadangan tempahan")}
            </button>
          ) : (
            <div className="core-form">
              <p>
                {w(
                  "This creates a request in your local calendar. Staff confirmation is a separate step.",
                  "Ini mencipta permohonan dalam kalendar setempat. Pengesahan kakitangan ialah langkah berasingan.",
                )}
              </p>
              {contactId ? (
                <p>
                  {w("Contact", "Kenalan")}: {bound.data?.name ?? "…"}
                </p>
              ) : (
                <>
                  <Field
                    label={w(
                      "Find contact for proposal",
                      "Cari kenalan untuk cadangan",
                    )}
                  >
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </Field>
                  <Field
                    label={w("Contact for proposal", "Kenalan untuk cadangan")}
                  >
                    <select
                      required
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                    >
                      <option value="">
                        {w("Choose a contact", "Pilih kenalan")}
                      </option>
                      {contacts.data?.items
                        .filter((c) => !c.deletion_pending)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </>
              )}
              <Notice error={contacts.error} />
              <div className="core-actions">
                <button
                  className="button button-dark"
                  disabled={
                    a.busy ||
                    !ready ||
                    !resourceReady ||
                    !(contactId ?? contact)
                  }
                  onClick={() =>
                    void a.run(() =>
                      client.execute("applyBookingProposal", {
                        sessionId,
                        id: proposal.id,
                        contactId: contactId ?? contact,
                        expectedProposalRevision: proposal.revision,
                      }),
                    )
                  }
                >
                  {w("Create booking request", "Cipta permohonan tempahan")}
                </button>
                <button onClick={() => setReview(false)}>
                  {w("Close review", "Tutup semakan")}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <small>
          {w(
            "Test artifact only. No message, notification or call is sent.",
            "Artifak ujian sahaja. Tiada mesej, pemberitahuan atau panggilan dihantar.",
          )}
        </small>
      )}
    </section>
  );
}
