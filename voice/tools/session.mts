// Helper for voice/tools/replay.py. Run from the repo root:
//   node --conditions=react-server --import tsx voice/tools/session.mts <command> [args]
//
//   ping            check the database is reachable (select 1)
//   start           create ONE voice test session (fixture knowledge, a booking
//                   resource called "QA Room") and start a real LiveKit voice call
//                   for it through the same command the web app uses. Prints one JSON
//                   line {url, token, room, sessionId, expiresAt} on stdout.
//   turns <id>      read-only: the stored turns, proposals and tool steps of one session
//
// stdout carries the JSON and nothing else. Errors go to stderr as one line and
// exit 1. Needs the local env (.env.local, .env.hosted) and JOMCALL_VOICE_PROVIDER=hosted;
// the real LiveKit room and dispatch path is used, with no fake. The local
// database only: the harness refuses any other host. It never cleans up, because
// deleting the organization would delete the session the call is using.
import { readFile } from "node:fs/promises";
import pg from "pg";

// Libraries may print; keep stdout for the JSON.
console.log = console.error;
console.info = console.error;

const fail = (error: unknown): never => {
  const e = error as { code?: string; message?: string; name?: string };
  const text =
    String(e?.code ?? e?.name ?? "Error") +
    ": " +
    String(e?.message ?? "").slice(0, 200);
  process.stderr.write(
    "session helper failed: " + text.replace(/\s+/g, " ") + "\n",
  );
  process.exit(1);
};

function adminPool() {
  const url = process.env.LOCAL_ADMIN_DATABASE_URL;
  if (!url) throw new Error("LOCAL_ADMIN_DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
    throw new Error("LOCAL_ONLY");
  return new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 3000,
    max: 1,
  });
}

async function ping() {
  const pool = adminPool();
  await pool.query("select 1");
  await pool.end();
  process.stdout.write(JSON.stringify({ ok: true }) + "\n");
}

async function turns(sessionId: string) {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new Error("bad session id");
  const pool = adminPool();
  const turnRows = (
    await pool.query(
      "select id,state,error_code,channel,length(answer) as answer_chars,timings,extract(epoch from created_at)*1000 as created_ms from app.test_turn where session_id=$1 order by created_at,id",
      [sessionId],
    )
  ).rows;
  const proposals = (
    await pool.query(
      "select turn_id,kind from app.test_proposal where session_id=$1 order by turn_id,step",
      [sessionId],
    )
  ).rows;
  const steps = (
    await pool.query(
      "select turn_id,tool from app.test_tool_step where session_id=$1 order by turn_id,step",
      [sessionId],
    )
  ).rows;
  await pool.end();
  const out = turnRows.map((t) => ({
    id: t.id,
    state: t.state,
    errorCode: t.error_code,
    channel: t.channel,
    answerChars: t.answer_chars,
    createdMs: Number(t.created_ms),
    timings: t.timings,
    tools: steps.filter((s) => s.turn_id === t.id).map((s) => s.tool),
    proposals: proposals.filter((p) => p.turn_id === t.id).map((p) => p.kind),
  }));
  process.stdout.write(JSON.stringify({ turns: out }) + "\n");
}

async function start() {
  process.env.JOMCALL_VOICE_PROVIDER ??= "hosted";
  // Imported late so the console redirect above is in place first.
  const { bookingFixture } = await import("../../tests/helpers/booking.ts");
  const f = await bookingFixture();
  const fixture = JSON.parse(
    await readFile(
      new URL("../../tests/fixtures/agent-evaluation.json", import.meta.url),
      "utf8",
    ),
  );
  const agent = f.h.orgA.agentId;
  const put = await f.req("PUT", `/agents/${agent}/draft`, {
    expectedRevision: 1,
    settings: {
      name: "Contoh Agent",
      languages: ["ms", "en"],
      manglish: true,
      greeting: "Selamat datang ke QA Studio Contoh.",
      instructions: "Answer politely and briefly.",
      aiDisclosure: "Anda bercakap dengan pembantu AI.",
      recordingEnabled: false,
      recordingDisclosure: "",
      voicePreference: "Kore",
    },
  });
  if (put.status !== 200) throw new Error("DRAFT_" + put.status);
  let revision = put.body.data.revision;
  for (const item of fixture.knowledge) {
    const r = await f.req("POST", `/agents/${agent}/knowledge`, {
      ...item,
      expectedAgentRevision: revision,
    });
    if (r.status !== 200) throw new Error("KNOWLEDGE_" + r.status);
    revision = r.body.data.revision;
  }
  const renamed = await f.req("PATCH", "/booking-resources/" + f.resource.id, {
    expectedRevision: 1,
    name: "QA Room",
    durationMinutes: 30,
    active: true,
  });
  if (renamed.status !== 200) throw new Error("RESOURCE_" + renamed.status);
  const session = await f.req("POST", "/agent-tests", {
    agentId: agent,
    locationId: f.h.orgA.locationId,
    source: { kind: "draft", expectedRevision: revision },
  });
  if (session.status !== 200) throw new Error("SESSION_" + session.status);
  const s = session.body.data;
  const call = await f.req("POST", `/agent-tests/${s.id}/voice`, {
    expectedSessionRevision: s.revision,
  });
  if (call.status !== 200)
    throw new Error(
      "VOICE_START_" + call.status + "_" + (call.body?.error?.code ?? ""),
    );
  const d = call.body.data;
  process.stdout.write(
    JSON.stringify({
      url: d.url,
      token: d.token,
      room: d.room,
      sessionId: s.id,
      expiresAt: d.expiresAt,
    }) + "\n",
  );
}

try {
  const [command, arg] = process.argv.slice(2);
  if (command === "ping") await ping();
  else if (command === "start") await start();
  else if (command === "turns") await turns(arg ?? "");
  else throw new Error("usage: session.mts ping | start | turns <sessionId>");
  process.exit(0);
} catch (error) {
  fail(error);
}
