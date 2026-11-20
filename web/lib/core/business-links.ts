// The business's own pages, staged by setup's "Your links" card into the
// social_links fact. Checked as text only: nothing here opens a link.
export const LINK_KINDS = ["website", "facebook", "instagram", "tiktok", "linkedin", "maps"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
// extra: lines that are not one of the six links (older free text, a second
// link of the same kind), kept as they were and written back after the links.
export type Links = Partial<Record<LinkKind, string>> & { extra?: string };

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

// One "Label: URL" line per link, in LINK_KINDS order, then any extra lines.
export const linksToText = (links: Links) =>
  [
    ...LINK_KINDS.filter((k) => links[k]).map((k) => `${LINK_LABELS[k]}: ${links[k]}`),
    ...(links.extra ? [links.extra] : []),
  ].join("\n");

const isLink = (text: string) => {
  const r = normaliseLink("website", text);
  return !!r && "url" in r;
};

export function textToLinks(text: string): Links {
  const out: Links = {};
  const extra: string[] = [];
  const byLabel = new Map(LINK_KINDS.map((k) => [LINK_LABELS[k].toLowerCase(), k] as const));
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*([^:]+?)\s*:\s*(\S.*)$/);
    const kind = m && byLabel.get(m[1]!.toLowerCase());
    if (kind && !out[kind]) out[kind] = m![2]!.trim();
    // An unlabelled web address fills an empty Website; anything else (older
    // free text, a second link of a kind) is kept as it is.
    else if (!kind && !out.website && !/\s/.test(line.trim()) && isLink(line))
      out.website = line.trim();
    else extra.push(line.trim());
  }
  if (extra.length) out.extra = extra.join("\n");
  return out;
}
