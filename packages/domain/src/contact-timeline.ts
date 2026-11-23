// One contact's history, newest first: calls, WhatsApp chats, bookings,
// notes, consent records and follow-up items in one keyset-paged list
// (docs/superpowers/specs/2026-11-24-contact-timeline-design.md).
//
// Every role reads it. Calls give the call screen's summary columns only:
// never call turns or proposals (staff see the item, not the words), and
// never the billing columns, which the web role has no grant on. Follow-up
// items are hidden while the contact awaits PDPA deletion, as everywhere.
import type { PoolClient } from "pg";
import { AppError, uuid, type TenantContext } from "../../contracts/src/index.ts";
import type {
  ContactTimeline,
  TimelineEntry,
} from "../../contracts/src/contacts.ts";

const PAGE = 30;
const OPEN = 10;

// Each branch applies the cursor to its own sort time before its own limit,
// so a later page starts exactly after the last entry shown. $3/$4 are the
// cursor (null on the first page); $5 says whether follow-ups are shown.
const after = (at: string) =>
  `($3::timestamptz is null or (${at},x.id)<($3::timestamptz,$4::uuid))`;
const branch = (sql: string, at: string) =>
  `(${sql} and ${after(at)} order by ${at} desc,x.id desc limit ${PAGE + 1})`;

const FOLLOW_UP_DATA = `jsonb_build_object('follow_up_kind',x.kind,'source',x.source,'state',x.state,'due_at',x.due_at,
  'call_id',x.call_id,'conversation_id',x.conversation_id,
  'text',left(case x.kind when 'message' then x.details->>'text' when 'handoff' then x.details->>'reason' else x.details->>'title' end,200))`;

const TIMELINE = [
  branch(
    `select 'call' as kind,x.id,x.started_at as at,jsonb_build_object('state',x.state,'refusal',x.refusal,'outcome',x.outcome,
      'duration_seconds',x.duration_seconds,'after_hours',x.after_hours,'transfer_result',x.transfer_result) as data
     from app.call x where x.org_id=$1 and x.contact_id=$2`,
    "x.started_at",
  ),
  branch(
    `select 'chat',x.id,coalesce(x.last_message_at,x.created_at),jsonb_build_object('state',x.state,'owner',x.owner,
      'needs_attention',x.needs_attention,'last_author',m.author,'last_kind',m.kind,
      'last_body',case when m.kind='media' then '' else left(m.body,200) end)
     from app.conversation x
     left join lateral (select author,kind,body from app.message where org_id=x.org_id and conversation_id=x.id
       order by created_at desc,id desc limit 1) m on true
     where x.org_id=$1 and x.contact_id=$2`,
    "coalesce(x.last_message_at,x.created_at)",
  ),
  branch(
    `select 'booking',x.id,x.created_at,jsonb_build_object('title',x.title,'start_at',x.start_at,'status',x.status)
     from app.booking x where x.org_id=$1 and x.contact_id=$2`,
    "x.created_at",
  ),
  branch(
    `select 'note',x.id,x.created_at,jsonb_build_object('text',x.text)
     from app.contact_note x where x.org_id=$1 and x.contact_id=$2`,
    "x.created_at",
  ),
  branch(
    `select 'consent',x.id,x.created_at,jsonb_build_object('channel',x.channel,'purpose',x.purpose,'granted',x.granted,'evidence',x.evidence)
     from app.consent_record x where x.org_id=$1 and x.contact_id=$2`,
    "x.created_at",
  ),
  branch(
    `select 'follow_up',x.id,x.created_at,${FOLLOW_UP_DATA}
     from app.follow_up x where x.org_id=$1 and x.contact_id=$2 and $5::boolean`,
    "x.created_at",
  ),
].join(" union all ");

type Row = { kind: string; id: string; at: Date; sort_at: string; data: object };
const entry = (r: Row) =>
  ({ kind: r.kind, id: r.id, at: r.at.toISOString(), ...r.data }) as TimelineEntry;

// The cursor holds the sort time as the database printed it (a Date would
// lose microseconds), for this contact only.
function cursorOf(contactId: string, r: Row) {
  return Buffer.from(JSON.stringify([contactId, r.sort_at, r.id])).toString(
    "base64url",
  );
}
function parseCursor(raw: string | undefined, contactId: string) {
  if (!raw) return null;
  try {
    const [c, at, id] = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (
      c !== contactId ||
      typeof at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/.test(at)
    )
      throw new Error("bad");
    return { at, id: uuid.parse(id) };
  } catch {
    throw new AppError("INVALID_CURSOR", 422);
  }
}

export async function contactTimeline(
  tx: PoolClient,
  ctx: TenantContext,
  contact: { id: string; deletion_pending: boolean },
  cursor: string | undefined,
): Promise<ContactTimeline> {
  const start = parseCursor(cursor, contact.id);
  const showFollowUps = !contact.deletion_pending;
  const rows = (
    await tx
      .query(
        `select kind,id,at,at::text as sort_at,data from (${TIMELINE}) u order by at desc,id desc limit ${PAGE + 1}`,
        [ctx.orgId, contact.id, start?.at ?? null, start?.id ?? null, showFollowUps],
      )
      .catch((e: { code?: string }) => {
        // The pattern cannot rule out every impossible date; the database does.
        if (start && ["22007", "22008", "22003", "22P02"].includes(e?.code ?? ""))
          throw new AppError("INVALID_CURSOR", 422);
        throw e;
      })
  ).rows as Row[];
  const page = rows.slice(0, PAGE);
  // First page only: open follow-up items, oldest first.
  let open: TimelineEntry[] | null = null;
  if (!start)
    open = showFollowUps
      ? (
          (
            await tx.query(
              `select 'follow_up' as kind,x.id,x.created_at as at,x.created_at::text as sort_at,${FOLLOW_UP_DATA} as data
               from app.follow_up x where x.org_id=$1 and x.contact_id=$2 and x.state='open'
               order by x.created_at,x.id limit ${OPEN}`,
              [ctx.orgId, contact.id],
            )
          ).rows as Row[]
        ).map(entry)
      : [];
  return {
    items: page.map(entry),
    next: rows.length > PAGE ? cursorOf(contact.id, page[page.length - 1]) : null,
    open,
  };
}
