// Fake auto-parts catalogue: 270 model-specific rows + 30 universal rows = 300.
// Deterministic (no randomness) so questions can name exact rows.
// Part numbers and part brands are invented; car model names are only used as fitment labels.
import { createHash } from "node:crypto";

export const FITMENTS = {
  "myvi-lb": { label: "Myvi 1.3/1.5 2011-2017 (Lagi Best)", make: "perodua", f: 1.0 },
  "myvi-g3": { label: "Myvi 1.3/1.5 2018+ (G3)", make: "perodua", f: 1.1 },
  axia: { label: "Axia 1.0 2014+", make: "perodua", f: 0.9 },
  bezza: { label: "Bezza 1.0/1.3", make: "perodua", f: 0.95 },
  alza: { label: "Alza 1.5 2009-2021", make: "perodua", f: 1.1 },
  viva: { label: "Viva 660/850/1.0", make: "perodua", f: 0.85 },
  kancil: { label: "Kancil 660/850", make: "perodua", f: 0.8 },
  "saga-blm": { label: "Saga BLM/FLX 1.3", make: "proton", f: 0.9 },
  "saga-vvt": { label: "Saga VVT 2016+", make: "proton", f: 1.0 },
  wira: { label: "Wira 1.3/1.5", make: "proton", f: 0.9 },
  persona: { label: "Persona 1.6 (CPS/VVT)", make: "proton", f: 1.05 },
  iswara: { label: "Iswara 1.3", make: "proton", f: 0.8 },
  "vios-ncp93": { label: "Vios NCP93 2007-2013", make: "toyota", f: 1.25 },
  "vios-ncp150": { label: "Vios NCP150 2013+", make: "toyota", f: 1.35 },
  "city-gm6": { label: "City GM6 2014-2019", make: "honda", f: 1.4 },
} as const;
export type Fit = keyof typeof FITMENTS;

export const PARTS = {
  bpf: { label: "Brake pad depan", base: 55 },
  bsr: { label: "Brake shoe blkg", base: 48 },
  of: { label: "Oil filter", base: 12 },
  af: { label: "Air filter", base: 22 },
  cf: { label: "Aircond filter (cabin)", base: 25 },
  sp: { label: "Spark plug iridium (set 4)", base: 120 },
  tb: { label: "Timing belt", base: 85 },
  fb: { label: "Fan belt", base: 35 },
  abf: { label: "Absorber depan (1pc)", base: 130 },
  abr: { label: "Absorber blkg (1pc)", base: 95 },
  ck: { label: "Clutch kit 3in1", base: 320 },
  wp: { label: "Water pump", base: 110 },
  rad: { label: "Radiator", base: 260 },
  em: { label: "Engine mounting (set)", base: 180 },
  ds: { label: "Drive shaft (1 side)", base: 210 },
  la: { label: "Lower arm (1pc)", base: 90 },
  tre: { label: "Tie rod end", base: 38 },
  wb: { label: "Wheel bearing dpn", base: 75 },
} as const;
export type Part = keyof typeof PARTS;

const BRANDS = ["Nexa", "Kyoro", "ProGrip", "ori"];
const STOCK = ["ada stok", "ada stok", "ada stok", "stok 2 je", "kena order 2 hari", "ada stok"];

const digits = (seed: string, n: number) => {
  const h = createHash("sha256").update(seed).digest();
  return Array.from({ length: n }, (_, i) => String(h[i]! % 10)).join("");
};
const letters = (seed: string, n: number) => {
  const h = createHash("sha256").update("L" + seed).digest();
  return Array.from({ length: n }, (_, i) => "ABCDEFGHJKLMNPRSTUVWXYZ"[h[i]! % 23]).join("");
};

/** Invented part number in a make-specific shape. */
export function pn(fit: Fit, part: Part): string {
  const s = `${fit}:${part}`;
  switch (FITMENTS[fit].make) {
    case "perodua":
      return `${digits(s, 5)}-BZ${digits(s + "x", 3)}`;
    case "proton":
      return `PW${digits(s, 6)}`;
    case "toyota":
      return `${digits(s, 5)}-0D${digits(s + "x", 3)}`;
    default:
      return `${digits(s, 5)}-T${digits(s + "y", 1)}${letters(s, 1)}-${digits(s + "x", 3)}`;
  }
}

export type Row = {
  id: string;
  partNo: string;
  item: string;
  fitment: string;
  brand: string;
  priceSen: number;
  stock: string;
};

const UNIVERSAL: [code: string, partNo: string, item: string, fitment: string, brand: string, rm: number][] = [
  ["eo-5w30", "EO-5W30-4L", "Minyak enjin fully syn 5W-30 4L", "universal petrol", "Lubrix", 145],
  ["eo-0w20", "EO-0W20-4L", "Minyak enjin fully syn 0W-20 4L", "universal (hybrid/eco)", "Lubrix", 168],
  ["eo-10w40", "EO-10W40-4L", "Minyak enjin semi syn 10W-40 4L", "universal petrol", "Lubrix", 98],
  ["eo-15w40", "EO-15W40-4L", "Minyak enjin mineral 15W-40 4L", "universal petrol/diesel", "Torqa", 65],
  ["atf-d3", "ATF-D3-1L", "ATF Dexron III 1L", "auto gearbox 4AT", "Torqa", 28],
  ["cvt-1l", "CVTF-1L", "CVT fluid 1L", "gearbox CVT", "Lubrix", 42],
  ["cool-p", "CL-PINK-4L", "Coolant pink premix 4L", "universal", "Torqa", 38],
  ["cool-g", "CL-GRN-4L", "Coolant hijau premix 4L", "universal", "Torqa", 30],
  ["bf-d3", "BF-DOT3-500", "Brake fluid DOT3 500ml", "universal", "Nexa", 14],
  ["bf-d4", "BF-DOT4-500", "Brake fluid DOT4 500ml", "universal", "Nexa", 19],
  ["bat-ns40", "NS40ZL-MF", "Bateri NS40ZL MF", "Kancil/Viva/Axia/Myvi", "Voltra", 175],
  ["bat-ns60", "NS60-MF", "Bateri NS60 MF", "Saga/Wira/Vios/City", "Voltra", 235],
  ["bat-ns70", "NS70-MF", "Bateri NS70 MF", "MPV/4x4", "Voltra", 295],
  ["bat-din55", "DIN55L-MF", "Bateri DIN55L MF", "Persona/X70/continental", "Voltra", 340],
  ["blb-h4", "BLB-H4-6055", "Mentol lampu depan H4 60/55W", "universal", "Kyoro", 15],
  ["blb-h7", "BLB-H7-55", "Mentol H7 55W", "universal", "Kyoro", 22],
  ["blb-t10", "LED-T10-W", "LED T10 putih (sepasang)", "lampu kecil/plat", "Kyoro", 12],
  ["wip-14", "WPR-14", "Wiper blade 14 inci", "universal U-hook", "ProGrip", 14],
  ["wip-16", "WPR-16", "Wiper blade 16 inci", "universal U-hook", "ProGrip", 15],
  ["wip-18", "WPR-18", "Wiper blade 18 inci", "universal U-hook", "ProGrip", 16],
  ["wip-20", "WPR-20", "Wiper blade 20 inci", "universal U-hook", "ProGrip", 18],
  ["wip-21", "WPR-21", "Wiper blade 21 inci", "universal U-hook", "ProGrip", 19],
  ["wip-24", "WPR-24", "Wiper blade 24 inci", "universal U-hook", "ProGrip", 23],
  ["bat-water", "BW-1L", "Air bateri 1L", "bateri basah", "Voltra", 4],
  ["horn", "HRN-12V-D", "Hon 12V (disc, sepasang)", "universal", "Kyoro", 45],
  ["wheel-nut", "WN-M12-15", "Nat tayar M12x1.5 (1pc)", "Perodua/Toyota/Honda", "ProGrip", 3],
  ["flush", "EF-300", "Engine flush 300ml", "universal", "Lubrix", 18],
  ["gas-134", "R134A-CAN", "Gas aircond R134a (tin 340g)", "universal", "Torqa", 25],
  ["jumper", "JMP-500A", "Kabel jumper 500A", "universal", "ProGrip", 48],
  ["oil-treat", "OT-443", "Oil treatment 443ml", "universal", "Lubrix", 26],
];

export function buildCatalogue(): Row[] {
  const rows: Row[] = [];
  let n = 0;
  for (const fit of Object.keys(FITMENTS) as Fit[]) {
    for (const part of Object.keys(PARTS) as Part[]) {
      const h = createHash("sha256").update(`b:${fit}:${part}`).digest();
      const rm = Math.round(PARTS[part].base * FITMENTS[fit].f * (0.92 + (h[1]! % 17) / 100));
      rows.push({
        id: `cat:${fit}:${part}`,
        partNo: pn(fit, part),
        item: PARTS[part].label,
        fitment: FITMENTS[fit].label,
        brand: BRANDS[h[0]! % BRANDS.length]!,
        priceSen: rm * 100 + (h[2]! % 5 === 0 ? 50 : 0),
        stock: STOCK[n++ % STOCK.length]!,
      });
    }
  }
  for (const [code, partNo, item, fitment, brand, rm] of UNIVERSAL)
    rows.push({ id: `cat:u:${code}`, partNo, item, fitment, brand, priceSen: rm * 100, stock: "ada stok" });
  return rows;
}

const rm = (sen: number) => (sen % 100 ? `RM${(sen / 100).toFixed(2)}` : `RM${sen / 100}`);
/** One catalogue row the way it would look pasted from the owner's spreadsheet. */
export const rowText = (r: Row) =>
  `${r.partNo} | ${r.item} | ${r.fitment} | ${r.brand} | ${rm(r.priceSen)} | ${r.stock}`;
