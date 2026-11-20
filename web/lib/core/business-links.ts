// The business's own pages, staged by setup's "Your links" card into the
// social_links fact. Checked as text only: nothing here opens a link.
export const LINK_KINDS = ["website", "facebook", "instagram", "tiktok", "linkedin", "maps"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type Links = Partial<Record<LinkKind, string>>;

export const LINK_LABELS: Record<LinkKind, string> = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  maps: "Google Maps",
};

export const MAX_LINK = 300;

// Hosts each field expects; a mismatch is a warning, never a refusal.
const HOSTS: Record<Exclude<LinkKind, "website">, (host: string, path: string) => boolean> = {
  facebook: (h) => /(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(h),
  instagram: (h) => /(^|\.)instagram\.com$/.test(h),
  tiktok: (h) => /(^|\.)tiktok\.com$/.test(h),
  linkedin: (h) => /(^|\.)linkedin\.com$/.test(h),
  maps: (h, p) =>
    h === "maps.app.goo.gl" ||
    h === "g.page" ||
    h === "goo.gl" ||
    /^maps\.google\./.test(h) ||
    (/(^|\.)google\.[a-z.]+$/.test(h) && p.startsWith("/maps")),
};

export function normaliseLink(
  kind: LinkKind,
  text: string,
): { url: string; warning: boolean } | { error: "invalid" | "too_long" } | null {
  const raw = text.trim();
  if (!raw) return null;
  if (raw.length > MAX_LINK) return { error: "too_long" };
  // A bare address gets https; any other scheme is refused.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { error: "invalid" };
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes("."))
    return { error: "invalid" };
  const url = u.toString();
  if (url.length > MAX_LINK) return { error: "too_long" };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  return { url, warning: kind !== "website" && !HOSTS[kind](host, u.pathname) };
}

// One "Label: URL" line per link, in LINK_KINDS order.
export const linksToText = (links: Links) =>
  LINK_KINDS.filter((k) => links[k])
    .map((k) => `${LINK_LABELS[k]}: ${links[k]}`)
    .join("\n");

export function textToLinks(text: string): Links {
  const out: Links = {};
  const byLabel = new Map(LINK_KINDS.map((k) => [LINK_LABELS[k].toLowerCase(), k] as const));
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]+?)\s*:\s*(\S.*)$/);
    const kind = m && byLabel.get(m[1]!.toLowerCase());
    if (kind) out[kind] = m![2]!.trim();
    // Older free text (an interview answer) lands in Website once, so the
    // owner sees it and can move it.
    else if (line.trim() && !out.website) out.website = line.trim();
  }
  return out;
}
