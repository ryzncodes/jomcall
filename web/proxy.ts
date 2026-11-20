import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PUBLIC_PAGES } from "./lib/site.ts";

const PUBLIC_PATHS = new Set<string>(PUBLIC_PAGES.map((p) => p.path));

// Old `?lang=` links on public pages go to the path-based language.
export function legacyRedirect(url: URL): URL | null {
  const lang = url.searchParams.get("lang");
  if (lang !== "ms" && lang !== "en") return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : "/";
  if (!PUBLIC_PATHS.has(path)) return null;
  const target = new URL(url.href);
  target.pathname = lang === "ms" ? (path === "/" ? "/ms" : `/ms${path}`) : path;
  target.searchParams.delete("lang");
  target.searchParams.delete("theme");
  return target;
}

export function proxy(request: NextRequest) {
  const target = legacyRedirect(new URL(request.url));
  return target ? NextResponse.redirect(target, 301) : NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!app|api|login|signup|docs|self-host|_next).*)",
      has: [{ type: "query", key: "lang" }],
    },
  ],
};
