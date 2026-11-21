import test from "node:test";
import assert from "node:assert/strict";
import { linksToText, normaliseLink, textToLinks } from "../../web/lib/core/business-links.ts";

test("links: bare address gets https", () => {
  assert.deepEqual(normaliseLink("facebook", " facebook.com/kedai "), {
    url: "https://facebook.com/kedai",
    warning: false,
  });
});

test("links: wrong host warns", () => {
  assert.equal((normaliseLink("facebook", "instagram.com/x") as { warning: boolean }).warning, true);
  assert.equal((normaliseLink("website", "kedaicontoh.example") as { warning: boolean }).warning, false);
});

test("links: maps hosts", () => {
  for (const u of [
    "https://www.google.com/maps/place/Kedai",
    "https://maps.google.com/?cid=1",
    "https://maps.app.goo.gl/abc",
    "https://g.page/kedai",
  ])
    assert.equal((normaliseLink("maps", u) as { warning: boolean }).warning, false, u);
  assert.equal((normaliseLink("maps", "https://www.google.com/search?q=x") as { warning: boolean }).warning, true);
});

test("links: refused", () => {
  assert.deepEqual(normaliseLink("website", "javascript:alert(1)"), { error: "invalid" });
  assert.deepEqual(normaliseLink("website", "ftp://x.example"), { error: "invalid" });
  assert.deepEqual(normaliseLink("website", "localhost"), { error: "invalid" });
  assert.deepEqual(normaliseLink("website", "a.example/" + "x".repeat(300)), { error: "too_long" });
  assert.equal(normaliseLink("website", "   "), null);
});

test("links: round trip", () => {
  const x = { website: "https://kedai.example/", facebook: "https://facebook.com/kedai", maps: "https://maps.app.goo.gl/abc" };
  assert.deepEqual(textToLinks(linksToText(x)), x);
  assert.equal(linksToText(x).split("\n")[0], "Website: https://kedai.example/");
});

test("links: lines that are not one of the six links are kept", () => {
  const x = textToLinks("kedai.example\nIG @kedai\nFacebook: https://facebook.com/a\nFacebook: https://facebook.com/b");
  assert.equal(x.website, "kedai.example");
  assert.equal(x.facebook, "https://facebook.com/a");
  assert.equal(x.extra, "IG @kedai\nFacebook: https://facebook.com/b");
  const back = linksToText({ ...x, instagram: "https://instagram.com/kedai" });
  assert.match(back, /IG @kedai/);
  assert.match(back, /facebook\.com\/b/);
  assert.deepEqual(textToLinks("We are on Facebook as Kedai"), { extra: "We are on Facebook as Kedai" });
});
