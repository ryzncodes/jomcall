// Hand-written ground truth for the 12 fake source documents.
// All businesses, people, addresses and phone numbers are invented.
import { buildCatalogue } from "../search/catalogue.ts";

export type Trap =
  | "unreadable" // price physically hidden in the source: the right answer is "cannot read"
  | "ambiguous" // partly obscured digit: right if correct OR flagged
  | "corrected" // an old price was replaced; truth is the new one
  | "approx" // owner said "about": must be flagged for the owner
  | "no-price"; // "call" / "tanya boss" / TBA: no price exists

export type TruthRow = {
  item: string;
  variant?: string;
  /** Other acceptable wordings of the variant. */
  variantAlt?: string[];
  priceSen: number | null;
  unit?: string[];
  trap?: Trap;
  /** Fine to extract or to leave out (fees that could equally be a fact). */
  optional?: boolean;
};
export type TruthFact = { label: string; must: RegExp[] };
export type Doc = {
  id: string;
  kind: "image" | "pdf" | "xlsx" | "chat";
  file: string;
  about: string;
  rows: TruthRow[];
  facts: TruthFact[];
  /** Text that must NOT show up in rows or facts (chat clutter, spam). */
  mustNot?: RegExp[];
};

const U = {
  pc: ["pc", "pcs", "piece", "pieces", "biji", "unit", "each", "keping", "sekeping", "helai", "sehelai", "pc."],
  kg: ["kg", "kilo", "kilogram"],
  pair: ["pasang", "sepasang", "pair", "set"],
  pax: ["pax", "orang", "person", "head"],
  stick: ["cucuk", "stick", "batang", "pc", "pcs"],
  set: ["set"],
  person: ["orang", "person", "waiter", "pax"],
  night: ["malam", "night", "semalam"],
  sqft: ["kaki persegi", "sq ft", "sqft", "sekaki persegi", "square foot", "kps", "ft2", "ft²"],
  subject: ["subjek", "subject", "sebulan", "month", "bulan"],
  hour: ["jam", "hour", "sejam", "hr"],
  day: ["hari", "day", "sehari"],
  year: ["tahun", "year", "setahun"],
  tin: ["tin", "can", "pc", "unit"],
  drum: ["tong", "pail", "drum", "tin"],
  bottle: ["botol", "bottle"],
  length: ["batang", "length", "pc", "pcs"],
  roll: ["gulung", "roll"],
  box: ["box", "kotak"],
  jar: ["balang", "jar"],
  tray: ["loyang", "tray"],
};

const r = (item: string, variant: string | undefined, rm: number | null, extra: Partial<TruthRow> = {}): TruthRow => ({
  item,
  ...(variant ? { variant } : {}),
  priceSen: rm === null ? null : Math.round(rm * 100),
  ...extra,
});

// ── D05 source rows come from the fake catalogue generator ──
const cat = buildCatalogue().filter((x) => x.id.startsWith("cat:myvi-g3:") || x.id.startsWith("cat:saga-vvt:"));
export const PDF_PARTS = cat.map((x) => ({ ...x, tba: x.id === "cat:saga-vvt:rad" }));

export const DOCS: Doc[] = [
  {
    id: "d01",
    kind: "image",
    file: "d01-salon-pricelist.jpg",
    about: "Photographed printed salon price list, BM/English, taped-over price, handwritten correction",
    rows: [
      r("Potong Rambut / Haircut", "Wanita", 35),
      r("Potong Rambut / Haircut", "Lelaki", 20),
      r("Potong Rambut / Haircut", "Kanak-kanak", 15),
      r("Cuci & Blow", undefined, 25),
      r("Warna Rambut / Colouring", "Pendek", 120),
      r("Warna Rambut / Colouring", "Sederhana", 160),
      r("Warna Rambut / Colouring", "Panjang", 200),
      r("Rebonding", "Pendek", 220),
      r("Rebonding", "Panjang", 350),
      r("Keratin Treatment", undefined, 280),
      r("Rawatan Rambut / Hair Treatment", undefined, 50),
      r("Scalp Treatment", undefined, 95, { trap: "corrected" }),
      r("Facial Basic", undefined, 68),
      r("Facial Deep Cleansing", undefined, 98),
      r("Manicure", undefined, 35),
      r("Pedicure", undefined, null, { trap: "unreadable" }),
      r("Threading Kening", undefined, 8),
      r("Bridal Makeup (Nikah)", undefined, 450),
      r("Deposit bridal", undefined, 100, { optional: true }),
    ],
    facts: [
      { label: "hours", must: [/selasa|tue/i, /ahad|sun/i, /10/, /8/] },
      { label: "closed Monday", must: [/isnin|monday/i] },
      { label: "address", must: [/12-?g/i, /seri mawar/i, /bangi/i] },
      { label: "phone", must: [/011-?\s?5550\s?0142/] },
      { label: "bridal deposit not refundable", must: [/deposit/i, /tidak dikembalikan|non-?refundable|not refundable|tak refund/i] },
    ],
  },
  {
    id: "d02",
    kind: "image",
    file: "d02-kopitiam-menu.jpg",
    about: "Photographed chalkboard-style menu, BM/English/Chinese, hot and iced price columns, glare over one price",
    rows: [
      ...(
        [
          ["Kopi O", 1.8, 2.2],
          ["Kopi", 2.0, 2.5],
          ["Kopi C", 2.2, 2.7],
          ["Teh O", 1.8, 2.2],
          ["Teh Tarik", 2.2, 2.7],
          ["Milo", 2.8, 3.3],
          ["Cham", 2.3, 2.8],
        ] as [string, number, number][]
      ).flatMap(([n, hot, ice]) => [r(n, "Panas", hot, { variantAlt: ["hot", "热"] }), r(n, "Ais", ice, { variantAlt: ["iced", "ice", "cold", "冰", "sejuk"] })]),
      r("Limau Ais", undefined, 2.5),
      r("Barli", "Panas", 2.0, { variantAlt: ["hot", "热"] }),
      r("Barli", "Ais", null, { trap: "unreadable", variantAlt: ["iced", "ice", "cold", "冰"] }),
      r("Roti Bakar Kaya", undefined, 2.5),
      r("Telur Separuh Masak (2 biji)", undefined, 2.8),
      r("Nasi Lemak Biasa", undefined, 3.5),
      r("Nasi Lemak Ayam Goreng", undefined, 9),
      r("Mee Goreng Mamak", undefined, 7.5),
      r("Kuey Teow Goreng", undefined, 8),
      r("Laksa", undefined, 8.5),
      r("Wantan Mee", "Kecil", 7, { variantAlt: ["small", "小"] }),
      r("Wantan Mee", "Besar", 8.5, { variantAlt: ["large", "big", "大"] }),
      r("Tambah telur", undefined, 1.5),
      r("Bungkus", undefined, 0.3, { optional: true }),
    ],
    facts: [
      { label: "hours", must: [/6[.:]30/, /3\s?(pm|ptg|petang)|15[.:]00/i] },
      { label: "closed Wednesday", must: [/rabu|wednesday|星期三/i] },
      { label: "cash and QR only", must: [/cash|tunai/i, /qr/i] },
      { label: "no service charge", must: [/caj servis|service charge/i] },
    ],
  },
  {
    id: "d03",
    kind: "image",
    file: "d03-aircon-flyer.jpg",
    about: "Photographed colour flyer with a service x horsepower price grid, promo sticker over one cell",
    rows: [
      ...(
        [
          ["Servis Biasa / Normal Service", [80, 80, 100, 100]],
          ["Chemical Wash", [130, 150, 180, 200]],
          ["Chemical Overhaul", [210, 230, null, 280]],
        ] as [string, (number | null)[]][]
      ).flatMap(([n, ps]) => ["1.0HP", "1.5HP", "2.0HP", "2.5HP"].map((hp, i) =>
          r(n, hp, ps[i]!, {
            variantAlt: [hp.replace(".0", ""), hp.replace("HP", " HP")],
            // The promo sticker hides the 2.0HP overhaul price and half-covers the 2.0HP chemical wash price above it.
            ...(ps[i] === null ? { trap: "unreadable" as Trap } : n === "Chemical Wash" && hp === "2.0HP" ? { trap: "ambiguous" as Trap } : {}),
          }),
        ),
      ),
      r("Top up gas", "R22", 80),
      r("Top up gas", "R410A", 120),
      r("Top up gas", "R32", 100),
      r("Pemasangan / Installation", "1.0-1.5HP", 250, { variantAlt: ["1.0 1.5HP", "1.0HP 1.5HP"] }),
      r("Pemasangan / Installation", "2.0-2.5HP", 300, { variantAlt: ["2.0 2.5HP", "2.0HP 2.5HP"] }),
      r("Inspection", undefined, 50),
      r("Buka unit / Dismantle", undefined, 80),
      r("Cassette", undefined, null, { trap: "no-price", optional: true }),
    ],
    facts: [
      { label: "hours", must: [/isnin|mon/i, /sabtu|sat/i, /9/, /6/] },
      { label: "service warranty 30 days", must: [/warranty|waranti|jaminan/i, /30/] },
      { label: "coverage area", must: [/shah alam/i, /klang/i, /puchong/i] },
      { label: "phone", must: [/012-?\s?555\s?0177/] },
      { label: "wall mounted only / cassette call", must: [/wall/i] },
    ],
  },
  {
    id: "d04",
    kind: "image",
    file: "d04-tuition-handwritten.jpg",
    about: "Photographed handwritten fee sheet, slightly blurred, one smudged digit",
    rows: [
      r("Tahun 1-3", undefined, 50, { unit: U.subject }),
      r("Tahun 4-6", undefined, 60, { unit: U.subject }),
      r("Tingkatan 1-3", undefined, 80, { unit: U.subject }),
      r("Tingkatan 4-5", undefined, 100, { unit: U.subject }),
      r("Add Maths", undefined, 120, { trap: "ambiguous" }),
      r("Pakej 3 subjek (Tahun 4-6)", undefined, 160),
      r("Pakej 4 subjek (Tingkatan 1-3)", undefined, 280),
      r("Pendaftaran", undefined, 50),
      r("Nota / bahan", undefined, 30, { unit: U.year }),
      r("Kelas 1-to-1", undefined, 70, { unit: U.hour }),
      r("Seminar SPM", undefined, 150, { unit: U.day }),
      r("Denda lewat", undefined, 10, { optional: true }),
    ],
    facts: [
      { label: "pay before the 7th", must: [/7\s?hb|7th|sebelum 7|before (the )?7/i] },
      { label: "late fine", must: [/lewat|late/i, /10/] },
      { label: "contact", must: [/farah/i, /013-?\s?555\s?0126/] },
      { label: "class hours", must: [/isnin|mon/i, /jumaat|fri/i, /3/, /10/] },
    ],
  },
  {
    id: "d05",
    kind: "pdf",
    file: "d05-autoparts-pricelist.pdf",
    about: "Two-page text PDF price list, 36 table rows with part numbers, one price TBA",
    rows: PDF_PARTS.map((x) => r(x.item, x.fitment, x.tba ? null : x.priceSen / 100, x.tba ? { trap: "no-price" } : {})),
    facts: [
      { label: "prices exclude labour", must: [/upah|labour|labor|installation|pasang/i] },
      { label: "valid until 31 Dec 2026", must: [/31/, /dis|dec/i, /2026/] },
      { label: "exchange within 7 days with receipt", must: [/7 hari|7 days/i, /resit|receipt/i] },
    ],
  },
  {
    id: "d06",
    kind: "pdf",
    file: "d06-dobi-ratecard-scan.pdf",
    about: "Image-only scanned PDF rate card, skewed, rubber stamp over one price",
    rows: [
      r("Cuci + Kering + Lipat", undefined, 4.5, { unit: U.kg }),
      r("Cuci sahaja", undefined, 3, { unit: U.kg }),
      r("Gosok / Ironing", undefined, 1.5, { unit: U.pc }),
      r("Baju kurung (dry clean)", undefined, 12, { unit: U.pair }),
      r("Kot / Blazer (dry clean)", undefined, 18, { unit: U.pc }),
      r("Langsir", undefined, 8, { unit: U.kg }),
      r("Comforter", "Single", 15),
      r("Comforter", "Queen", 20),
      r("Comforter", "King", null, { trap: "unreadable" }),
      r("Karpet", undefined, 3.5, { unit: U.sqft }),
      r("Kasut (cuci)", undefined, 20, { unit: U.pair }),
    ],
    facts: [
      { label: "hours", must: [/setiap hari|every day|daily/i, /8/, /10/] },
      { label: "unclaimed after 30 days", must: [/30 hari|30 days/i] },
      { label: "address", must: [/lot 3/i, /kebun nenas/i, /klang/i] },
      { label: "express +50%", must: [/express|ekspres/i, /50\s?%/] },
      { label: "minimum 3kg", must: [/min/i, /3\s?kg/i] },
    ],
  },
  {
    id: "d07",
    kind: "xlsx",
    file: "d07-hardware-pricelist.xlsx",
    about: "Spreadsheet with a merged title, two header rows, merged category rows, retail and wholesale price columns, a text price and a 'tanya boss' cell",
    rows: (
      [
        ["Cat emulsion putih 5L", 62, 55, U.tin],
        ["Cat emulsion putih 18L", 185, 170, U.drum],
        ["Cat kilat hitam 1L", 28.5, 25, U.tin],
        ["Thinner 1L", 9, 7.5, U.bottle],
        ['Berus cat 2"', 4.5, 3.8, U.pc],
        ['Paip PVC 1/2" x 5.8m', 9.9, 8.5, U.length],
        ['Paip PVC 3/4" x 5.8m', 14.5, 12.8, U.length],
        ['Elbow PVC 1/2"', 0.8, 0.6, U.pc],
        ["Kepala paip (tap) besi", 18, 15, U.pc],
        ["Seal tape", 1.5, 1.2, U.roll],
        ["Wayar 1.5mm 100m", 145, 132, U.roll],
        ["Suis 1 gang", 6.5, 5.5, U.pc],
        ["Plug 13A", 4.8, null, U.pc],
        ["Mentol LED 9W", 7.9, 6.5, U.pc],
        ["Extension 3 gang 3m", 32, 28, U.pc],
      ] as [string, number, number | null, string[]][]
    ).flatMap(([n, retail, bulk, unit]) => [
      r(n, "Runcit", retail, { unit, variantAlt: ["retail"] }),
      r(n, "Borong", bulk, { unit, variantAlt: ["wholesale", "borong (≥10)", "bulk"], ...(bulk === null ? { trap: "no-price" as Trap } : {}) }),
    ]),
    facts: [
      { label: "prices may change", must: [/berubah|change/i] },
      { label: "free delivery within 10km for RM300+", must: [/10\s?km/i, /300/] },
      { label: "hours", must: [/isnin|mon/i, /sabtu|sat/i, /8/, /6/] },
      { label: "tap out of stock until next week", must: [/stok habis|out of stock/i] },
    ],
  },
  {
    id: "d08",
    kind: "xlsx",
    file: "d08-bakery-orders.xlsx",
    about: "Two-sheet spreadsheet: cake sizes as columns with a 'new price' column overriding some, and a pastry sheet with min-order column",
    rows: [
      r("Kek Coklat Moist", "6 inci", 55, { variantAlt: ['6"', "6 inch", "6in"] }),
      r("Kek Coklat Moist", "8 inci", 90, { trap: "corrected", variantAlt: ['8"', "8 inch", "8in"] }),
      r("Kek Coklat Moist", "10 inci", 120, { variantAlt: ['10"', "10 inch", "10in"] }),
      r("Red Velvet", "6 inci", 65, { variantAlt: ['6"', "6 inch"] }),
      r("Red Velvet", "8 inci", 95, { variantAlt: ['8"', "8 inch"] }),
      r("Red Velvet", "10 inci", 135, { variantAlt: ['10"', "10 inch"] }),
      r("Kek Pandan Gula Melaka", "6 inci", 60, { variantAlt: ['6"', "6 inch"] }),
      r("Kek Pandan Gula Melaka", "8 inci", 95, { trap: "corrected", variantAlt: ['8"', "8 inch"] }),
      r("Kek Pandan Gula Melaka", "10 inci", 125, { variantAlt: ['10"', "10 inch"] }),
      r("Cheesecake Blueberry", "6 inci", 75, { variantAlt: ['6"', "6 inch"] }),
      r("Cheesecake Blueberry", "8 inci", 110, { variantAlt: ['8"', "8 inch"] }),
      r("Kek Lapis Sarawak", undefined, 150, { unit: U.tray }),
      r("Karipap ayam", undefined, 0.9, { unit: U.pc }),
      r("Donut gula", undefined, 1.2, { unit: U.pc }),
      r("Roti sosej", undefined, 2.5, { unit: U.pc }),
      r("Tart telur", undefined, 2, { unit: U.pc }),
      r("Brownies (box of 9)", undefined, 28, { unit: U.box }),
      r("Cookies coklat chip (balang 400g)", undefined, 25, { unit: U.jar }),
      r("Delivery Kajang/Bangi", undefined, 10, { optional: true }),
    ],
    facts: [
      { label: "order 3 days ahead", must: [/3 hari|3 days/i] },
      { label: "deposit 50%", must: [/deposit/i, /50\s?%/] },
      { label: "delivery Kajang/Bangi RM10", must: [/kajang/i, /bangi/i, /10/] },
      { label: "pickup Seksyen 7 Bangi", must: [/seksyen 7/i] },
      { label: "10-inch cheesecake not made", must: [/10/, /tak buat|not (made|available)|tidak (dibuat|buat)|n\/a|unavailable|no 10/i] },
    ],
  },
  {
    id: "d09",
    kind: "xlsx",
    file: "d09-pet-grooming.xlsx",
    about: "One sheet with two tables side by side (cats, dogs), merged headers, 'dari 80' and 'call' prices",
    rows: [
      r("Kucing – Basic grooming", "Short hair", 45, { variantAlt: ["bulu pendek"] }),
      r("Kucing – Basic grooming", "Long hair", 60, { variantAlt: ["bulu panjang"] }),
      r("Kucing – Full grooming", "Short hair", 70),
      r("Kucing – Full grooming", "Long hair", 90),
      r("Kucing – Lion cut", undefined, 100),
      r("Kucing – Rawatan kutu", undefined, 15),
      r("Kucing – Rawatan kulat", undefined, 80, { trap: "approx" }),
      r("Anjing – Basic grooming", "Small", 50, { variantAlt: ["kecil"] }),
      r("Anjing – Basic grooming", "Medium", 70, { variantAlt: ["sederhana"] }),
      r("Anjing – Basic grooming", "Large", 95, { variantAlt: ["besar"] }),
      r("Anjing – Full grooming", "Small", 80),
      r("Anjing – Full grooming", "Medium", 110),
      r("Anjing – Full grooming", "Large", null, { trap: "no-price" }),
      r("Anjing – Deshedding", undefined, 30),
      r("Boarding", "Kucing", 25, { unit: U.night, variantAlt: ["cat"] }),
      r("Boarding", "Anjing", 40, { unit: U.night, variantAlt: ["dog"] }),
    ],
    facts: [
      { label: "closed Monday", must: [/isnin|monday/i] },
      { label: "hours", must: [/selasa|tue/i, /ahad|sun/i, /10/, /7/] },
      { label: "vaccination required for boarding", must: [/vaksin|vaccin/i] },
      { label: "WhatsApp", must: [/017-?\s?555\s?0164/] },
    ],
  },
  {
    id: "d10",
    kind: "chat",
    file: "d10-printing-chat.txt",
    about: "WhatsApp export: owner dictating new prices to staff, with a correction and an 'about RM65' price",
    rows: [
      r("T-shirt cotton round neck + print A4 1 warna", "1-10 pcs", 28, { unit: U.pc }),
      r("T-shirt cotton round neck + print A4 1 warna", "11-50 pcs", 22, { unit: U.pc }),
      r("T-shirt cotton round neck + print A4 1 warna", "51 ke atas", 18, { unit: U.pc, variantAlt: ["51+", "51 pcs", ">50", "51 and above"] }),
      r("Jersi microfiber sublimation full print", undefined, 35, { unit: U.pc }),
      r("Tote bag canvas print 1 side", undefined, 12),
      r("Mug putih print", undefined, 15),
      r("Mug magic", undefined, 24, { trap: "corrected" }),
      r("Sticker A4 mirrorkote", undefined, 6, { unit: U.pc }),
      r("Potong die-cut", undefined, 2),
      r("Banner", undefined, 4.5, { unit: U.sqft }),
      r("Bunting 2x5 kaki siap stand", undefined, 65, { trap: "approx" }),
      r("Design fee", undefined, 30),
    ],
    facts: [
      { label: "lead time 5-7 working days", must: [/5\s?-\s?7|5 (to|hingga) 7/i] },
      { label: "urgent 3 days +20%", must: [/urgent|segera/i, /20\s?%/] },
      { label: "deposit 50%", must: [/deposit/i, /50\s?%/] },
      { label: "hours", must: [/isnin|mon/i, /sabtu|sat/i, /9[.:]30/, /6[.:]30/] },
      { label: "closed Sunday", must: [/ahad|sunday/i] },
      { label: "address", must: [/no\.? ?7/i, /jalan dagang 2/i, /ampang/i] },
      { label: "new prices start 15 Nov", must: [/15/, /nov/i] },
      { label: "design fee free for 50+ pcs", must: [/50/, /free|percuma/i] },
    ],
  },
  {
    id: "d11",
    kind: "chat",
    file: "d11-catering-chat.txt",
    about: "Pasted Manglish + Mandarin catering price message with per-pax packages and add-ons",
    rows: [
      r("Package A 经济套餐", undefined, 12, { unit: U.pax }),
      r("Package B", undefined, 16, { unit: U.pax }),
      r("Package C 豪华", undefined, 22, { unit: U.pax }),
      r("Below 50 pax surcharge", undefined, 2, { unit: U.pax, optional: true }),
      r("Satay ayam", undefined, 1.2, { unit: U.stick }),
      r("Satay daging 沙爹牛肉", undefined, 1.5, { unit: U.stick }),
      r("Kuih muih", undefined, 0.8, { unit: U.pc }),
      r("Canopy + meja kerusi 1 set (10 org)", undefined, 80, { unit: U.set }),
      r("Waiter", undefined, 90, { unit: U.person }),
      r("Transport", undefined, 50, { optional: true }),
    ],
    facts: [
      { label: "minimum order 50 pax", must: [/min/i, /50\s?pax/i] },
      { label: "deposit 30%", must: [/deposit/i, /30\s?%/] },
      { label: "balance 3 days before", must: [/3 days|3 hari/i] },
      { label: "cancel <7 days forfeits deposit", must: [/cancel|batal/i, /7/] },
      { label: "not JAKIM certified", must: [/jakim/i] },
      { label: "contact", must: [/016-?\s?555\s?0118/] },
      { label: "Mandarin contact Jason", must: [/jason/i, /016-?\s?555\s?0119/] },
      { label: "free transport above RM1500 in Klang Valley", must: [/1,?500/, /klang valley|lembah klang/i] },
      { label: "satay ayam min 100", must: [/100/] },
    ],
  },
  {
    id: "d12",
    kind: "chat",
    file: "d12-bengkel-chat.txt",
    about: "Pasted chat, mostly shop facts and rules, with forwarded spam and unrelated banter around it",
    rows: [
      r("Servis biasa (minyak hitam + check)", "Kapcai", 35),
      r("Servis biasa (minyak hitam + check)", "Scooter", 45, { variantAlt: ["skuter"] }),
      r("Tukar tayar tiub – upah", undefined, 10),
      r("Tampal tayar tubeless", undefined, 8),
      r("Towing / angkut motor rosak dlm 5km", undefined, 30),
      r("Caj simpan motor", undefined, 5, { unit: U.day, optional: true }),
    ],
    facts: [
      { label: "closed Friday", must: [/jumaat|friday/i] },
      { label: "hours 9am-7pm", must: [/9/, /7/] },
      { label: "Ramadan closes 5pm", must: [/puasa|ramadan|ramadhan/i, /5/] },
      { label: "address", must: [/gerai no\.? ?4/i, /kuala selangor/i] },
      { label: "phone", must: [/019-?\s?555\s?0137/] },
      { label: "no big bikes 250cc+", must: [/250/] },
      { label: "no paint work", must: [/cat|spray|paint/i] },
      { label: "no credit, cash or QR", must: [/hutang|credit|kredit/i, /qr/i] },
      { label: "own parts no warranty", must: [/bawa sendiri|own parts|customer.{0,20}(parts|barang)|barang (customer|sendiri)/i] },
      { label: "labour warranty 7 days", must: [/7 hari|7 days/i] },
      { label: "storage charge after 14 days", must: [/14/] },
      { label: "service price excludes oil", must: [/tak termasuk minyak|exclud\w* (engine )?oil|not includ\w* (engine )?oil|tidak termasuk minyak/i] },
    ],
    mustNot: [/percuma 1|beli 1|11\.11|bit\.ly/i, /futsal/i],
  },
];
