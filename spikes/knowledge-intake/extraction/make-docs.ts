// Renders the 12 fake source documents into extraction/docs/.
// Images are HTML pages screenshotted through the locally installed Chrome with
// rotation, shadow, blur, noise and JPEG compression so they look photographed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { chromium, type Browser } from "playwright-core";
import { PDF_PARTS } from "./truth.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "docs");
mkdirSync(OUT, { recursive: true });

const photo = (inner: string, o: { rotate: number; skew?: number; desk: string; blur?: number; w?: number }) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%}
  body{background:${o.desk};display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:"Helvetica Neue",Arial,"PingFang SC",sans-serif}
  .sheet{width:${o.w ?? 820}px;transform:perspective(1600px) rotate(${o.rotate}deg) rotateY(${o.skew ?? 0}deg) rotateX(2deg);box-shadow:0 18px 40px rgba(0,0,0,.45);filter:blur(${o.blur ?? 0.5}px) contrast(.94) saturate(.9);position:relative}
  .light{position:fixed;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(0,0,0,.28) 0%,rgba(0,0,0,0) 38%,rgba(255,240,200,.10) 70%,rgba(0,0,0,.22) 100%)}
  .noise{position:fixed;inset:0;pointer-events:none;opacity:.16;mix-blend-mode:multiply}
  .hand{font-family:"Bradley Hand","Marker Felt","Noteworthy",cursive}
  .cover{position:relative}
</style>
<div class="sheet">${inner}</div>
<div class="light"></div>
<svg class="noise" width="100%" height="100%"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

// ── D01 salon price list ────────────────────────────────────────────────────
const d01 = photo(
  `<div style="background:#fbf8f1;padding:46px 54px;color:#2a2320">
  <div style="text-align:center;border-bottom:3px double #b0465f;padding-bottom:12px">
    <div style="font-size:34px;font-weight:800;letter-spacing:2px;color:#b0465f">SALON CANTIK MANIS</div>
    <div style="font-size:17px;letter-spacing:4px">SENARAI HARGA · PRICE LIST</div>
  </div>
  <style>
    .t{width:100%;border-collapse:collapse;font-size:19px;margin-top:14px}
    .t td{padding:6px 4px;border-bottom:1px dotted #c9bfb2}
    .t td:last-child{text-align:right;font-weight:700;white-space:nowrap}
    .sub td:first-child{padding-left:28px;color:#5b524c}
    .h td{font-weight:800;color:#b0465f;border-bottom:none;padding-top:12px}
  </style>
  <table class="t">
    <tr class="h"><td>Potong Rambut / Haircut</td><td></td></tr>
    <tr class="sub"><td>Wanita</td><td>RM35</td></tr>
    <tr class="sub"><td>Lelaki</td><td>RM20</td></tr>
    <tr class="sub"><td>Kanak-kanak</td><td>RM15</td></tr>
    <tr><td>Cuci &amp; Blow</td><td>RM25</td></tr>
    <tr class="h"><td>Warna Rambut / Colouring</td><td></td></tr>
    <tr class="sub"><td>Pendek</td><td>RM120</td></tr>
    <tr class="sub"><td>Sederhana</td><td>RM160</td></tr>
    <tr class="sub"><td>Panjang</td><td>RM200</td></tr>
    <tr class="h"><td>Rebonding</td><td></td></tr>
    <tr class="sub"><td>Pendek</td><td>RM220</td></tr>
    <tr class="sub"><td>Panjang</td><td>RM350</td></tr>
    <tr><td>Keratin Treatment</td><td>RM280</td></tr>
    <tr><td>Rawatan Rambut / Hair Treatment</td><td>RM50</td></tr>
    <tr><td>Scalp Treatment</td><td><s style="text-decoration-thickness:3px;text-decoration-color:#1b3a8a">RM90</s> <span class="hand" style="color:#1b3a8a;font-size:27px;display:inline-block;transform:rotate(-6deg)">RM95</span></td></tr>
    <tr><td>Facial Basic</td><td>RM68</td></tr>
    <tr><td>Facial Deep Cleansing</td><td>RM98</td></tr>
    <tr><td>Manicure</td><td>RM35</td></tr>
    <tr><td>Pedicure</td><td class="cover">RM45<span style="position:absolute;right:-14px;top:-3px;width:118px;height:38px;background:#d9c9a0;opacity:.98;transform:rotate(-3deg);box-shadow:0 1px 3px rgba(0,0,0,.35)"></span></td></tr>
    <tr><td>Threading Kening</td><td>RM8</td></tr>
    <tr><td>Bridal Makeup (Nikah)</td><td>RM450</td></tr>
  </table>
  <div style="margin-top:18px;font-size:15.5px;line-height:1.5;color:#463d38">
    Buka Selasa – Ahad, 10am – 8pm. <b>Isnin tutup.</b><br>
    No. 12-G, Jalan Seri Mawar 3, Seksyen 9, 43650 Bandar Baru Bangi<br>
    WhatsApp: 011-5550 0142<br>
    <i>*Deposit RM100 untuk bridal — tidak dikembalikan.</i>
  </div></div>`,
  { rotate: -2.4, skew: 3, desk: "radial-gradient(circle at 30% 20%,#8a745c,#4d3f31)" },
);

// ── D02 kopitiam menu ───────────────────────────────────────────────────────
const drinks: [string, string, string, string][] = [
  ["Kopi O", "咖啡乌", "1.80", "2.20"],
  ["Kopi", "咖啡", "2.00", "2.50"],
  ["Kopi C", "咖啡C", "2.20", "2.70"],
  ["Teh O", "茶乌", "1.80", "2.20"],
  ["Teh Tarik", "拉茶", "2.20", "2.70"],
  ["Milo", "美禄", "2.80", "3.30"],
  ["Cham", "参", "2.30", "2.80"],
  ["Limau Ais", "桔子冰", "—", "2.50"],
];
const food: [string, string, string][] = [
  ["Roti Bakar Kaya", "加椰面包", "2.50"],
  ["Telur Separuh Masak (2 biji)", "生熟蛋", "2.80"],
  ["Nasi Lemak Biasa", "椰浆饭", "3.50"],
  ["Nasi Lemak Ayam Goreng", "炸鸡椰浆饭", "9.00"],
  ["Mee Goreng Mamak", "嘛嘛炒面", "7.50"],
  ["Kuey Teow Goreng", "炒粿条", "8.00"],
  ["Laksa", "叻沙", "8.50"],
];
const d02 = photo(
  `<div style="background:#1f2b25;padding:40px 46px;color:#f1eee3;border:14px solid #6b4a2b" class="hand">
  <div style="text-align:center;font-size:40px;color:#ffe08a">KOPITIAM AH HOCK <span style="font-family:'PingFang SC'">亚福茶室</span></div>
  <div style="text-align:center;font-size:22px;letter-spacing:6px;margin-bottom:10px">— MENU —</div>
  <style>.m{width:100%;border-collapse:collapse;font-size:24px}.m td{padding:4px 6px}.m td.p{text-align:right;width:92px}.zh{font-family:"PingFang SC";font-size:19px;color:#cfd8c8;margin-left:8px}.hd td{color:#ffe08a;font-size:20px;border-bottom:2px solid #6f7d74}</style>
  <div style="font-size:26px;color:#9fe0c0;margin-top:6px">Minuman / Drinks <span class="zh">饮料</span></div>
  <table class="m">
    <tr class="hd"><td></td><td class="p">Panas <span class="zh" style="margin:0">热</span></td><td class="p">Ais <span class="zh" style="margin:0">冰</span></td></tr>
    ${drinks.map(([a, z, h, c]) => `<tr><td>${a}<span class="zh">${z}</span></td><td class="p">${h}</td><td class="p">${c}</td></tr>`).join("")}
    <tr><td>Barli<span class="zh">薏米水</span></td><td class="p">2.00</td><td class="p cover">2.40<span style="position:absolute;left:-40px;top:-34px;width:190px;height:110px;background:radial-gradient(ellipse at center,rgba(255,255,255,1) 0%,rgba(255,255,255,1) 38%,rgba(255,255,255,.55) 60%,rgba(255,255,255,0) 78%);filter:blur(3px)"></span></td></tr>
  </table>
  <div style="font-size:26px;color:#9fe0c0;margin-top:14px">Makanan / Food <span class="zh">食物</span></div>
  <table class="m">
    ${food.map(([a, z, p]) => `<tr><td>${a}<span class="zh">${z}</span></td><td class="p">${p}</td></tr>`).join("")}
    <tr><td>Wantan Mee<span class="zh">云吞面</span> — Kecil 小 / Besar 大</td><td class="p" style="width:150px">7.00 / 8.50</td></tr>
    <tr><td>+ Tambah telur<span class="zh">加蛋</span></td><td class="p">1.50</td></tr>
  </table>
  <div style="margin-top:14px;font-size:19px;color:#e8e2cf;line-height:1.45">
    Buka 6.30am – 3pm · Tutup hari Rabu <span class="zh">星期三休息</span><br>
    Bungkus + RM0.30 · Tiada caj servis · Cash &amp; QR sahaja
  </div></div>`,
  { rotate: 0.9, skew: -4, desk: "linear-gradient(160deg,#c9c2b4,#8f887b)", blur: 0.6, w: 800 },
);

// ── D03 aircon flyer ────────────────────────────────────────────────────────
const d03 = photo(
  `<div style="background:linear-gradient(180deg,#e9f6ff,#ffffff 30%);padding:36px 40px;color:#0e2a44">
  <div style="background:#0b6fb8;color:#fff;padding:14px 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center">
    <div><div style="font-size:31px;font-weight:900">SEJUK MAJU AIRCOND</div><div style="font-size:15px;letter-spacing:2px">HARGA SERVIS 2026 · SERVICE PRICE</div></div>
    <div style="font-size:42px">❄</div>
  </div>
  <style>.g{width:100%;border-collapse:collapse;margin-top:16px;font-size:18px}.g th{background:#ffd23f;padding:8px;border:2px solid #0e2a44}.g td{padding:9px 8px;border:2px solid #0e2a44;text-align:center;font-weight:700}.g td:first-child{text-align:left;font-weight:800}.l{font-size:17.5px;line-height:1.75;margin-top:10px}.l b{float:right}</style>
  <table class="g">
    <tr><th>Wall mounted (RM / unit)</th><th>1.0HP</th><th>1.5HP</th><th>2.0HP</th><th>2.5HP</th></tr>
    <tr><td>Servis Biasa / Normal Service</td><td>80</td><td>80</td><td>100</td><td>100</td></tr>
    <tr><td>Chemical Wash</td><td>130</td><td>150</td><td>180</td><td>200</td></tr>
    <tr><td>Chemical Overhaul</td><td>210</td><td>230</td><td class="cover">260<span style="position:absolute;left:-12px;top:-22px;width:108px;height:84px;background:#e11d2e;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:900;transform:rotate(-14deg);box-shadow:0 2px 5px rgba(0,0,0,.4);border:3px dashed #fff">PROMO!</span></td><td>280</td></tr>
  </table>
  <div style="display:flex;gap:26px;margin-top:10px">
    <div class="l" style="flex:1"><div style="font-weight:900;color:#0b6fb8">TOP UP GAS</div>
      R22 <b>RM80</b><br>R410A <b>RM120</b><br>R32 <b>RM100</b></div>
    <div class="l" style="flex:1.4"><div style="font-weight:900;color:#0b6fb8">LAIN-LAIN</div>
      Pemasangan / Installation 1.0–1.5HP <b>RM250</b><br>Pemasangan / Installation 2.0–2.5HP <b>RM300</b><br>Inspection (percuma jika repair) <b>RM50</b><br>Buka unit / Dismantle <b>RM80</b></div>
  </div>
  <div style="margin-top:12px;font-size:13.5px;color:#34495e">*Harga untuk wall mounted sahaja. Cassette — sila call.</div>
  <div style="margin-top:10px;background:#0e2a44;color:#fff;padding:12px 16px;border-radius:8px;font-size:16.5px;line-height:1.5">
    ☎ 012-555 0177 · Isnin – Sabtu 9am – 6pm<br>Kawasan: Shah Alam · Klang · Subang · Puchong &nbsp;|&nbsp; Warranty servis 30 hari
  </div></div>`,
  { rotate: 3.1, skew: 4, desk: "radial-gradient(circle at 70% 30%,#3d4a57,#1c232b)", w: 830 },
);

// ── D04 handwritten tuition fees ────────────────────────────────────────────
const d04 = photo(
  `<div class="hand" style="background:repeating-linear-gradient(#fffef6 0 39px,#b9d3ee 39px 40px);padding:36px 48px 30px 70px;color:#17306b;font-size:27px;line-height:40px;border-left:3px solid #e5a0a0">
  <div style="font-size:33px;text-decoration:underline">Pusat Tuisyen Cemerlang – Yuran 2026</div>
  <div>&nbsp;</div>
  <div>Tahun 1–3 ......... RM50 / subjek</div>
  <div>Tahun 4–6 ......... RM60 / subjek</div>
  <div>Tingkatan 1–3 ..... RM80 / subjek</div>
  <div>Tingkatan 4–5 ..... RM100 / subjek</div>
  <div>Add Maths ......... RM<span class="cover">1<span style="position:absolute;left:-7px;top:6px;width:20px;height:30px;background:radial-gradient(ellipse,rgba(40,50,90,.9),rgba(40,50,90,.45) 60%,rgba(40,50,90,0));filter:blur(2.5px);border-radius:50%"></span></span>20</div>
  <div>Pakej 3 subjek (Tahun 4–6) — RM160</div>
  <div>Pakej 4 subjek (Tingkatan 1–3) — RM280</div>
  <div>Pendaftaran — RM50 (sekali)</div>
  <div>Nota / bahan — RM30 setahun</div>
  <div>Kelas 1-to-1 — RM70 sejam</div>
  <div>Seminar SPM — RM150 sehari</div>
  <div>&nbsp;</div>
  <div style="color:#8a1c1c">* Bayar sebelum 7hb setiap bulan. Lewat denda RM10</div>
  <div style="color:#8a1c1c">* Kelas Isnin–Jumaat 3pm–10pm</div>
  <div>Cikgu Farah 013-555 0126</div></div>`,
  { rotate: -3.6, skew: -3, desk: "linear-gradient(200deg,#5a4630,#2f2418)", blur: 0.9, w: 760 },
);

// ── D05 text PDF ────────────────────────────────────────────────────────────
const d05 = `<!doctype html><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:28px}
  h1{font-size:17px;margin:0}table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border:1px solid #888;padding:4px 6px;text-align:left}th{background:#ddd}
  td.r,th.r{text-align:right}thead{display:table-header-group}.f{margin-top:12px;font-size:10px}
</style>
<h1>MEGAH AUTO PARTS SDN BHD</h1><div>Senarai Harga Alat Ganti / Spare Parts Price List — November 2026</div>
<table><thead><tr><th>No</th><th>Part No</th><th>Description</th><th>Model</th><th>Brand</th><th class="r">Harga (RM)</th><th>Stok</th></tr></thead><tbody>
${PDF_PARTS.map((p, i) => `<tr style="height:${i % 2 ? 30 : 34}px"><td>${i + 1}</td><td>${p.partNo}</td><td>${p.item}</td><td>${p.fitment}</td><td>${p.brand}</td><td class="r">${p.tba ? "TBA" : (p.priceSen / 100).toFixed(2)}</td><td>${p.stock}</td></tr>`).join("")}
</tbody></table>
<div class="f">Harga tidak termasuk upah pasang. Harga sah sehingga 31 Dis 2026. Tukar barang dalam 7 hari dengan resit.</div>`;

// ── D06 scanned rate card (image-only PDF) ──────────────────────────────────
const d06inner = photo(
  `<div style="background:#f4f1ea;padding:50px 58px;color:#111;font-family:'Times New Roman',serif">
  <div style="text-align:center;font-size:33px;font-weight:bold">DOBI BERSIH WANGI</div>
  <div style="text-align:center;font-size:19px;margin-bottom:14px">Kadar Harga / Price Rate</div>
  <style>.d{width:100%;border-collapse:collapse;font-size:20px}.d td{border:1px solid #333;padding:8px 10px}.d td:last-child{text-align:right;white-space:nowrap}</style>
  <table class="d">
    <tr><td>Cuci + Kering + Lipat (min 3kg)</td><td>RM4.50 / kg</td></tr>
    <tr><td>Cuci sahaja</td><td>RM3.00 / kg</td></tr>
    <tr><td>Gosok / Ironing</td><td>RM1.50 / helai</td></tr>
    <tr><td>Baju kurung (dry clean)</td><td>RM12 / pasang</td></tr>
    <tr><td>Kot / Blazer (dry clean)</td><td>RM18 / helai</td></tr>
    <tr><td>Langsir</td><td>RM8 / kg</td></tr>
    <tr><td>Comforter — Single</td><td>RM15</td></tr>
    <tr><td>Comforter — Queen</td><td>RM20</td></tr>
    <tr><td>Comforter — King</td><td class="cover">RM25<span style="position:absolute;right:-26px;top:-46px;width:150px;height:150px;border-radius:50%;background:rgba(150,20,40,.95);border:5px double #f4f1ea;color:#f4f1ea;display:flex;align-items:center;justify-content:center;text-align:center;font:bold 17px Arial;transform:rotate(-18deg)">DOBI<br>BERSIH WANGI<br>★ KLANG ★</span></td></tr>
    <tr><td>Karpet</td><td>RM3.50 / kaki persegi</td></tr>
    <tr><td>Kasut (cuci)</td><td>RM20 / pasang</td></tr>
  </table>
  <div style="font-size:17px;margin-top:16px;line-height:1.5">Express (siap 4 jam): tambah 50%.<br>Buka setiap hari 8am – 10pm.<br>Barang tidak dituntut selepas 30 hari bukan tanggungjawab kami.<br>Lot 3, Jalan Kebun Nenas 2, 41200 Klang.</div></div>`,
  { rotate: 1.4, skew: 0, desk: "#e9e9e9", blur: 0.7, w: 780 },
);

// ── Chats ───────────────────────────────────────────────────────────────────
const d10 = `[12/11, 9:14 PM] Kak Ros Printing: Salam semua, harga baru start 15 Nov ye
[12/11, 9:14 PM] Kak Ros Printing: T-shirt cotton round neck + print A4 1 warna
[12/11, 9:15 PM] Kak Ros Printing: 1-10 pcs RM28
[12/11, 9:15 PM] Kak Ros Printing: 11-50 pcs RM22
[12/11, 9:15 PM] Kak Ros Printing: 51 ke atas RM18
[12/11, 9:16 PM] Kak Ros Printing: Jersi microfiber sublimation full print RM35 sehelai, min 10 pcs
[12/11, 9:17 PM] Kak Ros Printing: Tote bag canvas print 1 side RM12
[12/11, 9:17 PM] Aiman (staff): kak, mug berapa skrg?
[12/11, 9:18 PM] Kak Ros Printing: Mug putih print RM15, mug magic RM54
[12/11, 9:19 PM] Kak Ros Printing: eh silap, mug magic RM24 bukan RM54 😅
[12/11, 9:20 PM] Kak Ros Printing: Sticker A4 mirrorkote RM6 sekeping, potong die-cut tambah RM2
[12/11, 9:21 PM] Aiman (staff): banner?
[12/11, 9:22 PM] Kak Ros Printing: Banner RM4.50 sekaki persegi. Bunting 2x5 kaki siap stand lebih kurang RM65 kot, nanti akak confirm balik
[12/11, 9:23 PM] Kak Ros Printing: Design fee RM30 kalau takde artwork. Free kalau order 50 pcs ke atas
[12/11, 9:24 PM] Kak Ros Printing: Siap 5-7 hari bekerja. Urgent 3 hari tambah 20%
[12/11, 9:25 PM] Kak Ros Printing: Deposit 50% baru proses. Baki bayar masa ambil
[12/11, 9:26 PM] Aiman (staff): ok kak noted 👍
[12/11, 9:30 PM] Kak Ros Printing: Kedai buka Isnin-Sabtu 9.30am-6.30pm, Ahad tutup. Alamat sama: No 7, Jalan Dagang 2, Taman Dagang, Ampang
`;

const d11 = `Aunty Lim Catering 林阿姨餐饮 pricelist 2026 (forward to customer can)

Package A 经济套餐 – RM12/pax
 nasi putih, ayam masak merah, sayur campur, air sirap
Package B – RM16/pax
 nasi tomato / nasi minyak, ayam + daging rendang, acar, air + kuih 1 jenis
Package C 豪华 – RM22 per pax
 nasi briyani, kambing, ayam, dalca, buah, air 2 jenis
Min order 50 pax ya. Below 50 pax add RM2/pax

Add on:
- Satay ayam RM1.20/cucuk (min 100)
- 沙爹牛肉 satay daging RM1.50/cucuk
- Kuih muih RM0.80/pc
- Canopy + meja kerusi 1 set (10 org) RM80
- Waiter RM90/orang (4 jam)

Transport: Klang Valley free above RM1500, otherwise RM50. 外坡另算 (outstation charge separately, call first)
Deposit 30% to lock date, balance 3 days before event. Cancel less than 7 days deposit burn.
Halal — all ayam & daging supplier halal certified, but kitchen belum ada sijil JAKIM ya, jgn tulis "halal certified".
Booking: WhatsApp 016-555 0118 (Aunty Lim) / 讲华语可以找 Jason 016-555 0119
`;

const d12 = `Forwarded many times
📢 PROMO 11.11!! Beli 1 percuma 1 !!! Semua barang!!! klik link bit.ly/promo-example sekarang

ok ni info kedai utk letak dlm sistem ye:

Bengkel Motor Abang Din
Buka hari2 kecuali Jumaat. 9 pagi smpi 7 mlm. Jumaat tutup. Bulan puasa tutup awal pkl 5.
Alamat: Gerai No. 4, Medan Selera Lama, Jalan Besar, 45000 Kuala Selangor (belakang stesen minyak)
Call je 019-555 0137, whatsapp lambat reply sbb tgn minyak 😂

Servis biasa (minyak hitam + check) – kapcai RM35, scooter RM45, tak termasuk minyak
Tukar tayar tiub – upah RM10
Tampal tayar tubeless RM8
Towing/angkut motor rosak dlm 5km RM30, lebih tu kira ikut jauh
Tak buat motor besar (250cc ke atas) & tak buat cat/spray.
Hutang tak boleh ye, cash atau QR je.
Barang customer bawa sendiri boleh pasang tapi takde warranty.
Warranty upah 7 hari.
Motor siap tak ambil lebih 14 hari kena caj simpan RM5 sehari.

> Din: mlm ni futsal jadi x?
> Jai: jadi2 pkl 9
`;

// ── Spreadsheets ────────────────────────────────────────────────────────────
async function d07() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Harga");
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = "KEDAI HARDWARE TEGUH JAYA — PRICE LIST (updated 3/11)";
  ws.mergeCells("A2:B2");
  ws.getCell("A2").value = "Barang";
  ws.getCell("C2").value = "Unit";
  ws.mergeCells("D2:E2");
  ws.getCell("D2").value = "Harga (RM)";
  ws.getRow(3).values = ["Kod", "Nama", "", "Runcit", "Borong (≥10)", "Catatan"];
  const groups: [string, (string | number)[][]][] = [
    ["CAT & PAINT", [["C001", "Cat emulsion putih 5L", "tin", 62, 55], ["C002", "Cat emulsion putih 18L", "tong", 185, 170], ["C003", "Cat kilat hitam 1L", "tin", 28.5, 25], ["C004", "Thinner 1L", "botol", 9, 7.5], ["C005", 'Berus cat 2"', "pc", 4.5, 3.8]]],
    ["PAIP & PLUMBING", [["P001", 'Paip PVC 1/2" x 5.8m', "batang", 9.9, 8.5], ["P002", 'Paip PVC 3/4" x 5.8m', "batang", 14.5, 12.8], ["P003", 'Elbow PVC 1/2"', "pc", 0.8, 0.6], ["P004", "Kepala paip (tap) besi", "pc", 18, 15, "stok habis, sampai minggu depan"], ["P005", "Seal tape", "gulung", 1.5, 1.2]]],
    ["ELEKTRIK", [["E001", "Wayar 1.5mm 100m", "gulung", 145, 132], ["E002", "Suis 1 gang", "pc", 6.5, 5.5], ["E003", "Plug 13A", "pc", 4.8, "tanya boss"], ["E004", "Mentol LED 9W", "pc", 7.9, 6.5], ["E005", "Extension 3 gang 3m", "pc", "RM 32", 28]]],
  ];
  let row = 4;
  for (const [name, items] of groups) {
    ws.mergeCells(`A${row}:F${row}`);
    ws.getCell(`A${row}`).value = name;
    row++;
    for (const it of items) ws.getRow(row++).values = it;
    row++; // blank spacer row
  }
  ws.mergeCells(`A${row}:F${row}`);
  ws.getCell(`A${row}`).value = "Harga boleh berubah tanpa notis. Delivery free dalam 10km utk order RM300 ke atas.";
  ws.getCell(`A${row + 1}`).value = "Buka Isnin-Sabtu 8am-6pm";
  await wb.xlsx.writeFile(join(OUT, "d07-hardware-pricelist.xlsx"));
}

async function d08() {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Kek");
  a.mergeCells("A1:F1");
  a.getCell("A1").value = "Dapur Manis Bakery – senarai order";
  a.getRow(3).values = ["Kek", "6 inci", "8 inci", "10 inci", "Harga Baru 8 inci (Nov)", "Nota"];
  a.getRow(4).values = ["Kek Coklat Moist", 55, 85, 120, 90];
  a.getRow(5).values = ["Red Velvet", 65, 95, 135];
  a.getRow(6).values = ["Kek Pandan Gula Melaka", 60, 90, 125, 95, "best seller"];
  a.getRow(7).values = ["Cheesecake Blueberry", 75, 110, "-", null, "10 inci tak buat"];
  a.getRow(9).values = ["Kek Lapis Sarawak", "150/loyang"];
  a.getCell("A12").value = "Order 3 hari awal. Deposit 50%.";
  a.getCell("D13").value = "Delivery Kajang/Bangi RM10";
  const b = wb.addWorksheet("Pastri & Roti");
  b.getRow(1).values = ["Item", "Harga", "Unit", "Min order"];
  b.getRow(2).values = ["Karipap ayam", 0.9, "pc", 30];
  b.getRow(3).values = ["Donut gula", 1.2, "pc", 20];
  b.getRow(4).values = ["Roti sosej", 2.5, "pc", 10];
  b.getRow(5).values = ["Tart telur", 2, "pc", 12];
  b.getRow(6).values = ["Brownies (box of 9)", 28, "box"];
  b.getRow(7).values = ["Cookies coklat chip (balang 400g)", 25, "balang"];
  b.getCell("A10").value = "COD / pickup di Seksyen 7, Bangi";
  await wb.xlsx.writeFile(join(OUT, "d08-bakery-orders.xlsx"));
}

async function d09() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = "PAWS & CLAWS GROOMING";
  ws.mergeCells("A3:C3");
  ws.getCell("A3").value = "KUCING";
  ws.mergeCells("F3:I3");
  ws.getCell("F3").value = "ANJING";
  ws.getRow(4).values = ["", "Short hair", "Long hair", null, null, "", "Small", "Medium", "Large"];
  ws.getRow(5).values = ["Basic grooming (mandi+potong kuku+telinga)", 45, 60, null, null, "Basic grooming", 50, 70, 95];
  ws.getRow(6).values = ["Full grooming", 70, 90, null, null, "Full grooming", 80, 110, "call"];
  ws.getRow(7).values = ["Lion cut (semua)", 100, null, null, null, "Deshedding", "+30"];
  ws.mergeCells("B7:C7");
  ws.getRow(8).values = ["Rawatan kutu", "+15"];
  ws.getRow(9).values = ["Rawatan kulat", "dari 80"];
  ws.mergeCells("A11:C11");
  ws.getCell("A11").value = "BOARDING (semalam)";
  ws.getRow(12).values = ["Kucing", 25];
  ws.getRow(13).values = ["Anjing", 40];
  ws.getCell("F12").value = "Vaksin wajib lengkap utk boarding";
  ws.getCell("A15").value = "Tutup Isnin. Selasa–Ahad 10am–7pm";
  ws.getCell("A16").value = "WhatsApp 017-555 0164";
  await wb.xlsx.writeFile(join(OUT, "d09-pet-grooming.xlsx"));
}

// ── Render ──────────────────────────────────────────────────────────────────
async function shot(browser: Browser, html: string, file: string, w: number, h: number, quality: number) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
  await page.setContent(html, { waitUntil: "load" });
  const buf = await page.screenshot({ type: "jpeg", quality });
  await page.close();
  if (file) writeFileSync(join(OUT, file), buf);
  return buf;
}

const browser = await chromium.launch({ channel: "chrome" });
await shot(browser, d01, "d01-salon-pricelist.jpg", 1000, 1340, 58);
await shot(browser, d02, "d02-kopitiam-menu.jpg", 1000, 1300, 55);
await shot(browser, d03, "d03-aircon-flyer.jpg", 1040, 980, 58);
await shot(browser, d04, "d04-tuition-handwritten.jpg", 960, 1020, 50);
{
  const page = await browser.newPage();
  await page.setContent(d05, { waitUntil: "load" });
  await page.pdf({ path: join(OUT, "d05-autoparts-pricelist.pdf"), format: "A4", printBackground: true });
  const scan = await shot(browser, d06inner, "", 900, 1180, 52);
  await page.setContent(`<body style="margin:0"><img style="width:100%" src="data:image/jpeg;base64,${scan.toString("base64")}"></body>`, { waitUntil: "load" });
  await page.pdf({ path: join(OUT, "d06-dobi-ratecard-scan.pdf"), format: "A4", printBackground: true });
  await page.close();
}
await browser.close();
writeFileSync(join(OUT, "d10-printing-chat.txt"), d10);
writeFileSync(join(OUT, "d11-catering-chat.txt"), d11);
writeFileSync(join(OUT, "d12-bengkel-chat.txt"), d12);
await d07();
await d08();
await d09();
console.log("wrote 12 documents to", OUT);
