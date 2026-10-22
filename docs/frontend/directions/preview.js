import { mockApi } from "./mock-api.js";
const params = new URLSearchParams(location.search);
const direction = ["switchboard", "open", "appointment"].includes(
  params.get("direction"),
)
  ? params.get("direction")
  : "switchboard";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const lang = params.get("lang") === "ms" ? "ms" : "en";
const t = await fetch(`messages/${lang}.json`).then((r) => r.json());
const calls = await mockApi.getCalls();
const contacts = await mockApi.getContacts();
const idx = ["switchboard", "open", "appointment"].indexOf(direction);
document.documentElement.lang = lang;
document.documentElement.dataset.theme = theme;
document.body.className = direction;
document.title = `JomCall — ${t.directions[idx]}`;
const money = (sen) => `RM ${(sen / 100).toFixed(2)}`;
const time = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
const duration = (s) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const wave = (small = false) =>
  `<span class="wave ${small ? "small" : ""}" aria-hidden="true">${Array.from({ length: small ? 15 : 45 }, (_, i) => `<i style="--h:${18 + ((i * 37 + i * i * 3) % 80)}%;--i:${i}"></i>`).join("")}</span>`;
const conversation = `<div class="conversation" id="demo"><div class="demo-top"><span>${t.sample}</span><span class="mono">00:24</span></div>${wave()}<div class="turn disclosure"><span>${t.agent}</span><p>${t.disclosure}</p></div><div class="turn caller"><span>${t.caller}</span><p>${t.ask}</p></div><div class="tool">✓ ${t.tool}</div><div class="turn"><span>${t.agent}</span><p>${t.reply}</p></div><div class="demo-bottom">${t.result}</div></div>`;
const copy = `<div class="hero-copy"><h1>${t.hero[idx].replace("\n", "<br>")}</h1><p class="intro">${t.intro[idx]}</p><button class="primary play-demo">${t.cta}<span aria-hidden="true">↗</span></button><p class="keep">${t.keep}</p></div>`;
const ticket = `<div class="booking-slip"><span>${t.appointment}</span><strong>15:00</strong><span>${t.tomorrow}</span><hr><p>${t.service}</p><p>${t.sampleName}</p><div class="badge">✓ ${t.confirmed}</div></div>`;
const heroes = [
  `<section class="hero">${copy}<div class="signal-desk">${conversation}<div class="signal-caption">${t.languages}</div></div></section>`,
  `<section class="hero">${copy}<div class="shop-sign"><span>${t.hours}</span><strong>${t.sign}</strong><div class="sign-foot"><span>24/7</span><span>${t.languages}</span></div></div></section><section class="open-demo">${conversation}<div class="open-note"><p>${t.result}</p><span>${t.demoHint}</span></div></section>`,
  `<section class="hero">${copy}<div class="appointment-scene">${ticket}<p class="slip-note">${t.slip}</p></div></section><section class="appointment-demo">${conversation}<div class="book-caption">${t.languages}<p>${t.demoHint}</p></div></section>`,
];
const stats = `<div class="stats"><div><span>${t.total}</span><strong>3</strong></div><div><span>${t.booked}</span><strong>1</strong></div><div class="attention-stat"><span>${t.needs}</span><strong>1</strong></div><div><span>${t.cost}</span><strong>${money(calls.reduce((sum, c) => sum + c.cost_sen, 0))}</strong></div></div>`;
document.querySelector("#root").innerHTML = `
<a class="skip" href="#call-log">${t.skip}</a>
<div class="review-bar"><span>${t.review}</span><label>${t.direction}<select id="direction">${["switchboard", "open", "appointment"].map((v, i) => `<option value="${v}" ${v === direction ? "selected" : ""}>${t.directions[i]}</option>`).join("")}</select></label><label>${t.theme}<select id="theme"><option value="light" ${theme === "light" ? "selected" : ""}>${t.light}</option><option value="dark" ${theme === "dark" ? "selected" : ""}>${t.dark}</option></select></label><label>${t.language}<select id="lang"><option value="en" ${lang === "en" ? "selected" : ""}>EN</option><option value="ms" ${lang === "ms" ? "selected" : ""}>BM</option></select></label></div>
<header class="site-header"><a class="brand" href="?direction=${direction}&theme=${theme}&lang=${lang}"><span class="brand-mark" aria-hidden="true">c/</span>JomCall</a><a href="#call-log">${t.navApp}</a></header>
<main>${heroes[idx]}<div class="preview-note">${t.notLive}</div><section class="app-section" id="call-log"><div class="section-heading"><span>${t.appLabel}</span><h2>${t.appIntro}</h2></div><div class="app-frame"><aside class="app-sidebar"><strong>${t.business}</strong><span>${t.branch}</span><div class="app-nav"><span class="selected" aria-current="page">${t.calls}</span><span>${t.inbox}</span><span>${t.bookings}</span><span>${t.settings}</span></div><div class="disclosure-setting"><span>${t.recording}</span><strong>✓ ${t.on}</strong></div></aside><div class="app-content"><div class="app-top"><span>${t.today} / ${t.date}</span><span>${t.timezone}</span></div><h3>${t.callHeading}</h3><p class="sub">${t.callSub}</p>${stats}<div class="filters"><label class="search-label"><span class="sr-only">${t.search}</span><input type="search" id="search" placeholder="${t.search}"></label><label><span class="sr-only">${t.filter}</span><select id="filter"><option value="all">${t.all}</option><option value="attention">${t.attention}</option></select></label></div><div class="table-heading" aria-hidden="true"><span>${t.caller}</span><span>${t.outcome}</span><span>${t.duration}</span><span>${t.cost}</span></div><div id="call-rows"></div><p class="fake-note">${t.fake}</p></div></div></section></main><footer><span>JomCall</span><p>${t.end}</p></footer>
<dialog aria-labelledby="detail-title"><button class="close">${t.close}</button><h2 id="detail-title">${t.detailTitle}</h2><div id="detail-content"></div></dialog>`;
function renderCalls() {
  const search = document.querySelector("#search").value.toLocaleLowerCase();
  const attention = document.querySelector("#filter").value === "attention";
  const rows = calls.filter(
    (c) =>
      (!attention || c.outcome === 1) &&
      contacts
        .find((p) => p.id === c.contact_id)
        .name.toLocaleLowerCase()
        .includes(search),
  );
  document.querySelector("#call-rows").innerHTML = rows.length
    ? rows
        .map(
          (c) =>
            `<button class="call-row ${c.outcome === 1 ? "needs-attention" : ""}" data-call="${c.id}" aria-label="${t.details}: ${contacts.find((p) => p.id === c.contact_id).name}"><span class="who"><span class="avatar" aria-hidden="true">${c.outcome === 1 ? "↙" : "↗"}</span><span><strong>${contacts.find((p) => p.id === c.contact_id).name}</strong><small>${time(c.started_at)} · ${t.phone}</small></span></span><span class="call-outcome"><span class="badge">${c.outcome === 1 ? "!" : "✓"} ${t.rows[c.outcome]}</span><small>${c.language}</small></span><span class="call-duration">${wave(true)}<span>${duration(c.duration_seconds)}</span></span><span class="call-cost">${money(c.cost_sen)}<span aria-hidden="true">↗</span></span></button>`,
        )
        .join("")
    : `<p class="empty" role="status">${t.empty}</p>`;
  document.querySelectorAll("[data-call]").forEach((button) =>
    button.addEventListener("click", () => {
      const c = calls.find((c) => c.id === button.dataset.call);
      document.querySelector("#detail-content").innerHTML =
        `<p class="badge">${t.rows[c.outcome]}</p><h3>${contacts.find((p) => p.id === c.contact_id).name}</h3><p>${t.summaries[c.outcome]}</p><p class="mono">${time(c.started_at)} · ${duration(c.duration_seconds)} · ${money(c.cost_sen)}</p><p>${t.version}</p><hr><p>${t.recording}: <strong>${t.on}</strong></p><p>${t.consent}: ${t.consentValue} · ${time(c.started_at)} MYT</p><p>${t.notLive}</p>`;
      document.querySelector("dialog").showModal();
    }),
  );
}
renderCalls();
for (const id of ["direction", "theme", "lang"])
  document.querySelector(`#${id}`).addEventListener("change", (e) => {
    params.set(id, e.target.value);
    location.search = params.toString();
  });
document.querySelector("#search").addEventListener("input", renderCalls);
document.querySelector("#filter").addEventListener("change", renderCalls);
document
  .querySelector(".close")
  .addEventListener("click", () => document.querySelector("dialog").close());
document.querySelector(".play-demo").addEventListener("click", (e) => {
  const demo = document.querySelector("#demo");
  demo.classList.remove("replay");
  void demo.offsetWidth;
  demo.classList.add("replay");
  demo.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "center",
  });
  e.currentTarget.innerHTML = `${t.ctaDone}<span aria-hidden="true">↗</span>`;
});
