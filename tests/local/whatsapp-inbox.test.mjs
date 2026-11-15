// Static guards for the WhatsApp inbox screen (web/components/core/inbox.tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = "web/components/core/inbox.tsx";
const text = readFileSync(file, "utf8");
// Code without line comments, for wording checks.
const code = text
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");
const line = (at) => text.slice(0, at).split("\n").length;

// Top-level items of the call or array whose opening bracket is at `open`.
// Skips strings and template literals, so commas inside them do not count.
function items(source, open) {
  const out = [];
  let depth = 0,
    start = open + 1,
    i = open + 1;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < source.length && source[i] !== c; i++)
        if (source[i] === "\\") i++;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) {
      out.push(source.slice(start, i));
      start = i + 1;
    }
  }
  out.push(source.slice(start, i));
  return out.map((a) => a.trim()).filter((a, n, all) => a || n < all.length - 1);
}

test("every w( call in the inbox has an English and a BM argument", () => {
  const offenders = [];
  for (const m of text.matchAll(/(?<![\w.$])w\(/g)) {
    const args = items(text, m.index + 1);
    if (args.length !== 2 || args.some((a) => !a)) offenders.push(line(m.index));
  }
  assert.deepEqual(offenders, []);
});

test("every wording pair in the inbox has two different texts", () => {
  const offenders = [];
  let pairs = 0;
  // An opening bracket after a name is an index (Type["key"]), not a pair.
  for (const m of text.matchAll(/(?<![\w\]])\[\s*(?=["`])/g)) {
    const args = items(text, m.index);
    pairs++;
    if (args.length !== 2 || args.some((a) => !/^["`]/.test(a)) || args[0] === args[1])
      offenders.push(line(m.index));
  }
  assert.deepEqual(offenders, []);
  assert.ok(pairs > 40, `only ${pairs} pairs found`);
});

test("the inbox uses only the inbox commands and never sample data", () => {
  assert.doesNotMatch(text, /components\/product|crm-provider|localStorage|sessionStorage/);
  assert.doesNotMatch(text, /packages\/whatsapp/);
  // The send rules stay on the server.
  assert.doesNotMatch(text, /whatsapp\/policy|decideSend|windowOpen/);
  for (const command of [
    "whatsappOverview",
    "conversations",
    "conversation",
    "replyConversation",
    "takeoverConversation",
    "handbackConversation",
    "resolveConversation",
  ])
    assert.match(text, new RegExp(`["']${command}["']`), command);
});

test("the inbox has the four states and a retry", () => {
  assert.match(code, /Open WhatsApp settings/);
  assert.match(code, /href\("\/app\/whatsapp"\)/);
  assert.match(code, /No chats yet\./);
  assert.match(code, /<Loading \/>/);
  assert.ok((code.match(/"Retry", "Cuba lagi"/g) ?? []).length >= 2);
});

test("the reply box shows the server's outlook and keeps the draft on refusal", () => {
  assert.match(code, /detail\.reply_outlook\.allow/);
  assert.match(code, /outlookWords\(detail\.reply_outlook\)/);
  // The draft is cleared only after the server accepted the reply.
  const send = code.slice(code.indexOf("const send = async"), code.indexOf("const forbidden"));
  assert.match(send, /if \(done\) \{[^}]*setDraft\(""\)/);
  assert.equal((send.match(/setDraft\(""\)/g) ?? []).length, 1);
  // One idempotency key per draft: the exact first request is resent.
  assert.match(send, /nextAttempt\(attempt\.current, draft, detail\.revision/);
  assert.match(send, /expectedRevision: request\.expectedRevision/);
  assert.match(send, /request\.key,?\s*\)/);
  assert.match(send, /keepAttempt\(failure\)/);
  // Refused sending disables Send only; the draft stays editable.
  assert.doesNotMatch(code, /<textarea[^>]*\bdisabled=/);
  assert.doesNotMatch(code, /maxLength=/);
  assert.match(code, /utf8Bytes\(draft\)/);
});

test("the inbox never shows a full phone number", () => {
  assert.doesNotMatch(text, /contact_name \|\|/);
  assert.match(text, /displayName\(c\.contact_name, c\.wa_id\)/);
  assert.match(text, /displayName\(detail\.contact_name, detail\.wa_id\)/);
  assert.doesNotMatch(text, /\{(c|detail)\.wa_id\}/);
});

test("a slow poll cannot overwrite newer data", () => {
  assert.match(code, /at < shown\.current\) return/);
  assert.match(code, /if \(poll && loading\.current\) return/);
});

test("the inbox outlook reads the same SQL text as the agent process's send_claim", () => {
  const sql = readFileSync("packages/domain/src/whatsapp/send-facts-sql.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20261114120100_whatsapp_worker.sql",
    "utf8",
  );
  const claim = migration.slice(
    migration.indexOf("p_action='send_claim'"),
    migration.indexOf("p_action='send_result'"),
  );
  const squash = (t) => t.replace(/\s+/g, "");
  const parts = [...sql.matchAll(/export const (\w+Sql) =\s*`([^`]*)`/g)];
  assert.equal(parts.length, 3);
  for (const [, name, body] of parts)
    assert.ok(squash(claim).includes(squash(body)), `${name} drifted from send_claim`);
  const routes = readFileSync("packages/domain/src/whatsapp/routes.ts", "utf8");
  assert.match(routes, /now\(\) as now/);
  assert.doesNotMatch(routes, /new Date\(\)\.toISOString\(\)/);
});

test("hosted users see no local wording and no simulator hint", () => {
  assert.doesNotMatch(code, /\blocal\b|this computer|komputer ini|setempat/i);
  const hint = code.indexOf("npm run whatsapp:simulate");
  assert.ok(hint > 0);
  assert.match(code.slice(hint - 400, hint), /!HOSTED &&/);
});

test("the chrome shows Inbox only when WhatsApp is on, and the local app renders it", () => {
  const chrome = readFileSync("web/components/core/chrome.tsx", "utf8");
  assert.match(chrome, /channels\?\.whatsapp \? \[\] : \["inbox"\]/);
  const app = readFileSync("web/components/core/local-app.tsx", "utf8");
  const at = app.indexOf('screen === "inbox"');
  assert.ok(at >= 0, "no inbox screen branch");
  assert.match(app.slice(at, at + 80), /<LocalInbox \/>/);
});

test("the inbox CSS is one column on phones", () => {
  const css = readFileSync("web/app/core.css", "utf8");
  const at = css.indexOf(".wa-inbox {");
  assert.match(css.slice(at, at + 200), /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 900px\) \{\s*\.wa-inbox \{/);
});
