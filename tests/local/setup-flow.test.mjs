// Static guards for the guided setup flow screens (web/components/core/setup).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "web/components/core/setup";
const expected = [
  "flow.tsx",
  "business-type.tsx",
  "interview.tsx",
  "review.tsx",
  "finish.tsx",
  "bring.tsx",
  "upload.ts",
];
const sources = () =>
  readdirSync(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => ({ file: join(dir, f), text: readFileSync(join(dir, f), "utf8") }));

// Top-level arguments of the call whose "(" is at `open`. Skips strings,
// template literals and nested brackets, so commas inside them do not count.
function callArguments(text, open) {
  const args = [];
  let depth = 0,
    start = open + 1,
    i = open + 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  args.push(text.slice(start, i));
  // A trailing comma leaves an empty last argument.
  return args.map((a) => a.trim()).filter((a, n, all) => a || n < all.length - 1);
}

test("the setup flow files exist", () => {
  for (const f of expected) assert.ok(existsSync(join(dir, f)), `${f} missing`);
});

test("no setup stage has a Save button", () => {
  const offenders = [];
  for (const { file, text } of sources()) {
    if (/Save draft|Save knowledge/.test(text)) offenders.push(file);
    // A label that is exactly "Save" (or BM "Simpan"), not "Saved"/"Disimpan".
    if (/["'`>]\s*(Save|Simpan)\s*(["'`<]|$)/m.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("every w( call in the setup flow has an English and a BM argument", () => {
  const offenders = [];
  for (const { file, text } of sources()) {
    for (const m of text.matchAll(/(?<![\w.$])w\(/g)) {
      const open = m.index + 1;
      const args = callArguments(text, open);
      if (args.length !== 2 || args.some((a) => !a))
        offenders.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the local app renders SetupFlow for the setup screen", () => {
  const app = readFileSync("web/components/core/local-app.tsx", "utf8");
  const at = app.indexOf('screen === "setup"');
  assert.ok(at >= 0, "no setup screen branch");
  assert.match(app.slice(at, at + 200), /<SetupFlow\b/);
  assert.doesNotMatch(app, /\["builder",\s*"setup"\]/);
});

test("the setup flow stays out of the mock preview and pack data", () => {
  for (const { file, text } of sources())
    assert.doesNotMatch(text, /packs\/index|\.json["']/, file);
  for (const f of readdirSync("web/components/product"))
    assert.doesNotMatch(
      readFileSync(join("web/components/product", f), "utf8"),
      /core\/setup/,
      f,
    );
});

test("staff see the one setup message before anything loads", () => {
  const flow = readFileSync(join(dir, "flow.tsx"), "utf8");
  const at = flow.indexOf('workspace.role === "staff"');
  assert.ok(at >= 0 && at < flow.indexOf("<SetupLoader"), "staff check first");
  assert.ok(
    flow.includes("Setup is for owners and admins. Ask one of them to finish it."),
  );
  assert.ok(
    flow.includes("Persediaan untuk pemilik dan pentadbir. Minta mereka melengkapkannya."),
  );
});

test("the finish stage unlocks Publish only through the tested rule, on a fresh draft test", () => {
  const finish = readFileSync(join(dir, "finish.tsx"), "utf8");
  assert.match(finish, /unlocksPublish\(baseline\.current, d\)/);
  assert.match(finish, /searchParams\.delete\("testSession"\)/);
  assert.match(finish, /<LocalAgentTest[^>]*resume=\{false\}/);
  assert.match(finish, /<LocalAgentTest[^>]*startOn="draft"/);
  assert.doesNotMatch(finish, /setTested\(true\)[^]*setTested\(true\)/);
});

test("the interview prefills the name only through the tested rule", () => {
  const interview = readFileSync(join(dir, "interview.tsx"), "utf8");
  assert.match(interview, /namePrefill\(q\.fills,/);
  assert.doesNotMatch(interview, /fills\.includes\("facts\.business_name"\)/);
});

test("the chrome reads the channels command and hides unconnected channels", () => {
  const text = readFileSync("web/components/core/chrome.tsx", "utf8");
  assert.match(text, /execute\(\s*["']channels["']/);
  for (const [flag, key] of [
    ["phone", "phones"],
    ["whatsapp", "whatsapp"],
    ["integrations", "integrations"],
  ])
    assert.match(
      text,
      new RegExp(`channels\\?\\.${flag}\\s*\\?\\s*\\[\\]\\s*:\\s*\\["${key}"\\]`),
    );
  assert.match(text, /workspace\.complete && active !== "setup"/);
  assert.match(text, /filter\(\(item\) => !hidden\.includes\(item\.key\)\)/);
});

test("setup calls the AI agent ejen in BM and does not say nothing goes live before publish", () => {
  const files = [
    ...sources(),
    { file: "packages/domain/src/setup/questions.ts", text: readFileSync("packages/domain/src/setup/questions.ts", "utf8") },
  ];
  for (const { file, text } of files) assert.doesNotMatch(text, /\bagen\b/i, file);
  const review = readFileSync(join(dir, "review.tsx"), "utf8");
  assert.doesNotMatch(review, /Nothing goes live until you publish/);
  assert.match(review, /opening hours apply to bookings straight away/i);
});

test("workspace creation keeps the owner's own words for Something else", () => {
  const app = readFileSync("web/components/core/local-app.tsx", "utf8");
  assert.match(app, /businessTypeText\(/);
  assert.match(app, /What kind of business\?/);
  const at = app.indexOf('name="businessTypeOther"');
  assert.ok(at >= 0, "no free-text field");
  const tag = app.slice(app.lastIndexOf("<input", at), app.indexOf("/>", at));
  assert.match(tag, /\brequired\b/);
  assert.match(tag, /maxLength=\{80\}/);
  const setup = readFileSync(join(dir, "business-type.tsx"), "utf8");
  assert.match(setup, /typeIdForSaved\(/);
});

test("the bring stage shows the notice in both languages, unconditionally, above the file buttons", () => {
  const bring = readFileSync(join(dir, "bring.tsx"), "utf8");
  const en =
    "What you add here is sent to Anthropic, a company outside Malaysia, so its AI can read it. Do not add files or text with your customers' names, phone numbers or other personal details. Files and pasted text are deleted after 30 days. You can also delete one now with the Remove button while setup is open.";
  const ms =
    "Apa yang anda tambah di sini dihantar kepada Anthropic, sebuah syarikat di luar Malaysia, supaya AI mereka boleh membacanya. Jangan tambah fail atau teks yang mengandungi nama, nombor telefon atau butiran peribadi lain pelanggan anda. Fail dan teks yang ditampal dipadam selepas 30 hari. Anda juga boleh memadamnya sekarang dengan butang Buang semasa persediaan masih dibuka.";
  assert.ok(bring.includes(en), "English notice");
  assert.ok(bring.includes(ms), "BM notice");
  // The notice paragraph is the first thing directly inside .setup-body:
  // nothing (no condition, no expression) between that element's opening
  // and the paragraph, and the paragraph's own content is the icon and the
  // w( call only.
  const body = bring.indexOf('<div className="setup-body">');
  assert.ok(body >= 0, "setup-body");
  const open = body + '<div className="setup-body">'.length;
  const notice = bring.indexOf("<p", open);
  assert.equal(bring.slice(open, notice).trim(), "", "nothing before the notice");
  const close = bring.indexOf("</p>", notice);
  const para = bring.slice(notice, close);
  assert.ok(para.includes(en) && para.includes(ms), "notice inside the paragraph");
  assert.doesNotMatch(para.replace(en, "").replace(ms, ""), /&&|\?/);
  assert.ok(close < bring.indexOf('type="file"'), "before the file buttons");
});

test("two real labelled file controls: a photo one (image/*) and a general one; no capture, never Excel", () => {
  const bring = readFileSync(join(dir, "bring.tsx"), "utf8");
  const inputs = [...bring.matchAll(/type="file"/g)].map((m) => m.index);
  assert.equal(inputs.length, 2);
  const tags = inputs.map((at) => {
    assert.ok(bring.lastIndexOf("<label", at) > bring.lastIndexOf("</label>", at), "inside a label");
    return bring.slice(bring.lastIndexOf("<input", at), bring.indexOf("/>", at));
  });
  assert.match(tags[0], /accept="image\/\*"/);
  assert.match(tags[1], /accept=\{ACCEPT\}/);
  for (const t of tags) {
    assert.doesNotMatch(t, /capture/);
    assert.match(t, /onChange=\{pick\}/);
  }
  // One status line announces changes; the list itself is not live.
  assert.equal([...bring.matchAll(/aria-live="polite"/g)].length, 1);
  assert.match(bring, /role="status" aria-live="polite"/);
  assert.doesNotMatch(bring, /<ul[^>]*aria-live/);
  assert.match(bring, /role="alert"/);
  // Retry and Remove name the file.
  assert.match(bring, /`Retry \$\{r\.name\}`/);
  assert.match(bring, /`Remove \$\{r\.name\}`/);
});

test("the remove confirmation says confirmed and edited prices stay", () => {
  const bring = readFileSync(join(dir, "bring.tsx"), "utf8");
  assert.ok(
    bring.includes(
      "Remove this file? Prices and details read from it are removed too, except ones you confirmed. A price you edited counts as confirmed and stays.",
    ),
  );
  assert.ok(
    bring.includes(
      "Buang fail ini? Harga dan butiran yang dibaca daripadanya turut dibuang, kecuali yang sudah anda sahkan. Harga yang anda ubah dikira sudah disahkan dan kekal.",
    ),
  );
  assert.doesNotMatch(bring, /corrections you made to its prices are discarded/);
});

test("bring.tsx and upload.ts use only named commands and the two raw client calls", () => {
  const allowed = new Set([
    "createSetupUpload",
    "finishSetupUpload",
    "pasteSetupText",
    "removeSetupUpload",
    "setup",
  ]);
  for (const f of ["bring.tsx", "upload.ts"]) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|\/api\//, f);
    for (const m of text.matchAll(/\bclient\.(\w+)\(/g))
      assert.ok(["execute", "putChunk", "getChunk"].includes(m[1]), `${f}: client.${m[1]}`);
    for (const m of text.matchAll(/\bexecute\(\s*([^,\s)]+)/g))
      assert.ok(allowed.has(m[1].replace(/["']/g, "")), `${f}: execute(${m[1]})`);
  }
  const client = readFileSync("web/lib/core/client.ts", "utf8");
  assert.match(client, /async putChunk\(/);
  assert.match(client, /async getChunk\(/);
  assert.match(client, /"content-type": "application\/octet-stream"/);
});

test("no setup file says local or this computer outside a HOSTED check", () => {
  for (const { file, text } of sources())
    text.split("\n").forEach((line, n) => {
      if (/\blocal\b|setempat|this computer|komputer ini/i.test(line) && !/^\s*\/\//.test(line)) {
        // Allowed only inside a HOSTED ? ... : ... choice (on the line or
        // within the few lines before it).
        const near = text.split("\n").slice(Math.max(0, n - 3), n + 1).join("\n");
        assert.match(near, /HOSTED/, `${file}:${n + 1}`);
      }
    });
});

test("the flow opens the bring stage only with reading on, and links to it from interview and review", () => {
  const flow = readFileSync(join(dir, "flow.tsx"), "utf8");
  assert.match(flow, /useState\(\(\) => bringFirst\(initial\.view\)\)/);
  assert.match(flow, /setBringing\(bringFirst\(v\)\)/);
  assert.match(flow, /bringing && readerOn/);
  assert.match(flow, /const openBring = readerOn/);
  assert.match(flow, /readingNow\(view\.uploads, now, queuedSince\.current\)/);
  // The conflict check uses the save's own baseline, taken just before it
  // is sent, and the revision it carried; never a view read afterwards.
  assert.match(
    flow,
    /base = latestView\.current;\s*sent = revision\.current;\s*setView\(await fn\(sent\), at\)/,
  );
  assert.match(flow, /quietRetry\(base, sent, latestView\.current\)/);
  assert.doesNotMatch(flow, /onlyReadProgress\(before/);
  assert.match(flow, /bringVia === "link" \? leaveBring/);
  assert.match(flow, /document\.visibilityState === "visible"/);
  assert.match(flow, /pollDelay\(/);
  for (const f of ["interview.tsx", "review.tsx"]) {
    const text = readFileSync(join(dir, f), "utf8");
    assert.match(text, /\{onBring && \(/, f);
    assert.ok(text.includes('w("Add a document", "Tambah dokumen")'), f);
  }
});

test("leaving the screen empties the upload queue, and a failed Remove never resends", () => {
  const upload = readFileSync(join(dir, "upload.ts"), "utf8");
  // Cleanup: queue emptied and every job marked removed, not only aborted.
  assert.match(upload, /waiting\.current = \[\];\s*for \(const j of all\.values\(\)\) \{\s*j\.removed = true;\s*j\.controller\.abort\(\);/);
  // Nothing is created after the screen closed or the row was removed.
  assert.match(upload, /if \(job\.removed \|\| job\.controller\.signal\.aborted\) return;/);
  // Create and finish have a timeout and the job's signal.
  assert.match(upload, /within\(CREATE_MS,/);
  assert.match(upload, /within\(FINISH_MS, job\.controller\.signal,/);
  // A failed Remove keeps the job stopped.
  assert.doesNotMatch(upload, /job\.removed = false/);
  assert.doesNotMatch(upload, /job\.controller = new AbortController\(\)/);
  const bring = readFileSync(join(dir, "bring.tsx"), "utf8");
  assert.match(bring, /removeAgain\s*\?\s*void removeRow\(r\)\s*:\s*manager\.retry\(s\.key\)/);
});

test("the review page shows price rows and uses the reader's check flag", () => {
  const review = readFileSync(join(dir, "review.tsx"), "utf8");
  // The catalogue_row filter and the needsCheck rules live in rules.ts;
  // review.tsx renders through them (liveRows, groupRows, factFlagged) and
  // reads each row's checkReason.
  const rules = readFileSync(join(dir, "rules.ts"), "utf8");
  assert.match(rules, /export const liveRows[^]*?i\.kind === "catalogue_row"/);
  assert.match(rules, /i\.needsCheck && i\.state === "pending"/);
  assert.match(rules, /export const factFlagged[^]*?i\.needsCheck && i\.state === "pending"/);
  assert.match(review, /liveRows\(view\.items\)/);
  assert.match(review, /groupRows\(/);
  assert.match(review, /factFlagged\(item\)/);
  // The reason follows "Reason:"; the reader's own words are marked English.
  assert.match(review, /checkReason\(reason, w, price\)/);
  assert.match(review, /price=\{false\}/);
  assert.match(review, /<Reason reason=\{item\.checkReason\}/);
  assert.match(review, /lang=\{r\.reader \? "en" : undefined\}/);
  assert.match(review, /w\("Prices and services", "Harga dan perkhidmatan"\)/);
  // The price field: decimal keyboard, a label naming the item, sent on
  // leave or Enter only (a changed price confirms the row).
  assert.match(review, /inputMode="decimal"/);
  assert.match(review, /w\(`Price of \$\{name\}`, `Harga \$\{name\}`\)/);
  assert.match(review, /\{ debounce: false \}/);
  assert.match(review, /e\.key === "Enter"/);
  // Actions carry the item name.
  for (const s of ["`Confirm ${name}`", "`Remove ${name}`", "`Edit ${name}`", "`Use ${name} instead`"])
    assert.ok(review.includes(s), s);
  // One polite status line for the page.
  assert.equal([...review.matchAll(/aria-live="polite"/g)].length, 1);
  // The photo preview is a modal dialog, freed on close.
  assert.match(review, /showModal\(\)/);
  assert.match(review, /URL\.revokeObjectURL\(url\)/);
  assert.match(review, /type: "image\/jpeg"/);
  assert.match(review, /upload\.kind === "image"/);
  assert.match(review, /upload\.bytesDeletedAt/);
  // Removing a file reuses the bring stage's confirmation.
  assert.match(review, /import \{ RemoveFileConfirm \} from "\.\/bring"/);
  assert.match(readFileSync(join(dir, "bring.tsx"), "utf8"), /export function RemoveFileConfirm/);
  // Apply sends the replace and counts from the planner, decided after the
  // last write, and is disabled over the limit.
  assert.match(review, /base = store\.latest\(\);\s*const sent = store\.revision\(\);\s*const now = applySummary\(base, choices, w, summaryOpts\)/);
  // The counts know this browser's senders and the packs (unknown facts).
  assert.match(review, /summaryOpts = \{ senders: store\.uploads\.senders, packs \}/);
  // Asked again when more would be left out than the question said.
  assert.match(review, /askAgain\(asked, now\.counts\)/);
  assert.match(review, /onlyReadProgress\(base, fresh\)/);
  assert.match(review, /replace: now\.replace/);
  assert.match(review, /disabled=\{locked \|\| blocked\}/);
  assert.match(review, /locked = busy \|\| bulkRunning/);
});

test("price rows stay put for the visit; actions wait for their write; Remove all re-checks each row", () => {
  const review = readFileSync(join(dir, "review.tsx"), "utf8");
  // The order is worked out once (stableLayout over the previous layout),
  // never by focus.
  assert.match(review, /layoutRef\.current,\s*layoutOf\(groupRows\(/);
  assert.doesNotMatch(review, /setHeld|rowSection\(/);
  // Stable keys: one key per row id, whatever its look.
  assert.match(review, /<PriceRow\s+key=\{id\}/);
  // A removed row folds in place with Undo, then goes with focus moved to
  // the status line.
  assert.match(review, /`Undo removing \$\{name\}`/);
  assert.match(review, /if \(row\?\.contains\(document\.activeElement\)\) focusStatus\(\)/);
  // The Confirm slot stays after a confirm; buttons wait (aria-disabled,
  // keeping focus) while their write runs or Remove all runs.
  assert.match(review, /offered\.current &&/);
  assert.match(review, /const off = busy \|\| locked/);
  assert.match(review, /aria-disabled=\{off \|\| priceInvalid \|\| undefined\}/);
  // Remove all: each row checked again from the latest view before its
  // write, every action locked, progress shown, an early stop said.
  assert.match(review, /bulkRemovable\(latest, priceReplace\(latest, choicesRef\.current\), id\)/);
  assert.match(review, /onBulk\(true\)/);
  assert.match(review, /bulkText\("progress", bulk, w\)/);
  assert.match(review, /bulkText\("stopped"/);
  assert.match(review, /setBulk\(\{ done: seen \+ 1, total \}\)/);
  // A choice is keyed by the row and the saved price it matched.
  assert.match(review, /choices\[choiceKey\(i\)\]/);
  // The photo dialog closes on its backdrop only: no padding of its own.
  assert.match(review, /className="setup-viewer-body"/);
  const css = readFileSync("web/app/core.css", "utf8");
  assert.match(css, /\.setup-viewer \{[^}]*padding: 0;/);
});

test("a price change is never sent when the tab is hidden", () => {
  const flow = readFileSync(join(dir, "flow.tsx"), "utf8");
  assert.match(flow, /const onHide = sendsWhenHidden\(\{ debounce \}\)/);
  assert.match(flow, /if \(onHide\) \{\s*document\.addEventListener\("visibilitychange", hide\);\s*window\.addEventListener\("pagehide", leave\);\s*\}/);
  // Unmount still sends.
  assert.match(flow, /flushers\.delete\(flush\);\s*void flush\(\);/);
});

test("the review page and its rules import only the price planner from domain", () => {
  for (const f of ["review.tsx", "rules.ts"]) {
    const text = readFileSync(join(dir, f), "utf8");
    const domain = [...text.matchAll(/from\s+"([^"]*packages\/domain[^"]*)"/g)].map((m) => m[1]);
    for (const path of domain)
      assert.match(path, /packages\/domain\/src\/setup\/rows(\.ts)?$/, `${f}: ${path}`);
  }
  const rules = readFileSync(join(dir, "rules.ts"), "utf8");
  assert.match(rules, /import \{\s*planFromView,[^}]*\} from "\.\.\/\.\.\/\.\.\/\.\.\/packages\/domain\/src\/setup\/rows\.ts"/);
  // The mock preview never loads the setup screens (and so never the planner).
  for (const f of readdirSync("web/components/product"))
    assert.doesNotMatch(readFileSync(join("web/components/product", f), "utf8"), /packages\/domain\/src\/setup\/rows/, f);
});

test("the review page keeps choices, offers Use new only on conflicts, and never offers confirm-all", () => {
  const review = readFileSync(join(dir, "review.tsx"), "utf8");
  assert.match(review, /chooseRow\(store\.latest\(\)\.items, id, c\)/);
  assert.match(review, /a\.choice && item\.current/);
  assert.doesNotMatch(review, /Confirm all/i);
  assert.ok(review.includes("`Remove all ${unsure.length} that still need checking`"));
  assert.ok(review.includes('w("Remove everything from this file", "Buang semua daripada fail ini")'));
  // A conflict or limit refusal reloads the rows.
  assert.match(review, /e\.code === "CONFLICT" \|\| e\.code === "KNOWLEDGE_LIMIT"/);
  assert.match(review, /await store\.reload\(\)/);
});
