// The theme and language of a public page, applied while the HTML is still
// being parsed so the first paint already has them. It runs on public pages
// only: the app keeps choosing its theme from `?theme`, as before.
import { PUBLIC_PAGES, localePath } from "./site.ts";
import { THEME_KEY } from "./theme-key.ts";

export { THEME_KEY };

const PATHS = PUBLIC_PAGES.flatMap((p) => [
  localePath(p.id, "en"),
  localePath(p.id, "ms"),
]);

// Order: a valid `?theme` (stored, so it is honoured once and then kept),
// then the stored choice, then the operating system's setting.
export const PRE_PAINT_SCRIPT = `(function(){try{
var l=window.location,d=window.document.documentElement,p=l.pathname.replace(/\\/+$/,"")||"/";
if(${JSON.stringify(PATHS)}.indexOf(p)<0)return;
if(p==="/ms"||p.indexOf("/ms/")===0)d.lang="ms";
var k=${JSON.stringify(THEME_KEY)},s=null,t=null;
try{s=window.localStorage}catch(e){}
var q=/(?:^|[?&])theme=(light|dark)(?:&|$)/.exec(l.search);
if(q){t=q[1];try{s&&s.setItem(k,t)}catch(e){}}
else{try{var v=s&&s.getItem(k);if(v==="light"||v==="dark")t=v}catch(e){}}
if(!t)t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
d.dataset.theme=t;d.style.colorScheme=t;
}catch(e){}})();`;
