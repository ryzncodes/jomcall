// Fake knowledge for four fake businesses, written the way owners write:
// mixed BM / English / Manglish, a little Mandarin, abbreviations, MYR prices.
// Every name, address and phone number is invented.
export type Biz = "salon" | "aircon" | "tuition" | "auto";
export type Segment = { id: string; biz: Biz; doc: string; text: string };

const seg = (biz: Biz, doc: string, rows: [string, string][]): Segment[] =>
  rows.map(([id, text]) => ({ id, biz, doc, text }));

export const SEGMENTS: Segment[] = [
  // ───────── Salon: Seri Ayu Hair & Beauty ─────────
  ...seg("salon", "Info kedai", [
    ["sal-hours", "Buka Selasa–Ahad 10am–8pm. Isnin tutup. Public holiday buka macam biasa kecuali Raya 1st & 2nd day tutup."],
    ["sal-addr", "Alamat: No. 12-G, Jalan Seri Mawar 3, Seksyen 9, 43650 Bandar Baru Bangi (sebelah kedai dobi, atas ada klinik gigi). Parking depan kedai free."],
    ["sal-contact", "WhatsApp / call 011-5550 0142. IG: @seriayu.hair"],
    ["sal-stylists", "Stylist: Kak Lina (senior, colour specialist), Mei (perm/rebonding), Aina (junior – cut & wash). Senior stylist charge tambah RM10 utk cut."],
    ["sal-zh", "华语顾客欢迎，Mei 会讲华语和广东话。染发前请先做皮肤敏感测试（免费）。"],
    ["sal-hijab", "Ada bilik tertutup utk pelanggan bertudung (muslimah room), stylist perempuan sahaja. Kena booking sebab 1 bilik je."],
  ]),
  ...seg("salon", "Price list", [
    ["sal-cut-w", "Potong rambut perempuan: RM35 (wash + blow incl). Fringe/bang trim je RM10."],
    ["sal-cut-m", "Men haircut RM20, with wash RM25. Budak bawah 12 thn RM15."],
    ["sal-wash", "Wash & blow RM25. Wash + set/curl RM45."],
    ["sal-color", "Colour full head: short RM120, medium RM160, long RM200+. Root touch up RM80. Guna colour ammonia-free, sesuai utk ibu mengandung tapi kena inform dulu."],
    ["sal-highlight", "Highlight / balayage start RM250, depends panjang & berapa foil. Bleach extra RM60 per round."],
    ["sal-rebond", "Rebonding RM220 (short) – RM350 (long). Ambil masa 3-4 jam. Tak boleh basuh rambut 3 hari lepas rebond."],
    ["sal-keratin", "Keratin treatment RM280 semua panjang, tahan 3-4 bulan. Free 1 botol shampoo sulfate-free."],
    ["sal-perm", "Digital perm RM260-RM380. Cold perm RM150."],
    ["sal-treat", "Hair treatment: basic RM50, scalp treatment (kelemumur/gatal) RM90, hair spa RM70."],
    ["sal-facial", "Facial basic RM68, deep cleansing RM98, whitening RM128. 60-75 min."],
    ["sal-nails", "Manicure RM35, pedicure RM45, gel colour add RM30. Combo mani+pedi RM70."],
    ["sal-wax", "Threading kening RM8, upper lip RM6. Waxing underarm RM25, full leg RM80."],
    ["sal-bridal", "Bridal package: makeup + hairdo/tudung styling RM450 (nikah), RM650 (sanding, incl touch up 2 jam). Trial makeup RM120. Deposit RM100, booking min 1 bulan awal."],
    ["sal-products", "Jual produk: shampoo sulfate-free 300ml RM45, hair serum argan RM38, hair mask RM55, heat protectant spray RM32."],
    ["sal-promo", "Promo bulan ni: rebonding + treatment RM250 (weekday sahaja). Colour + cut RM140 utk rambut pendek."],
  ]),
  ...seg("salon", "Polisi", [
    ["sal-booking", "Booking through WhatsApp, walk-in boleh tapi weekend selalu penuh. Lambat lebih 15 minit, slot dilepaskan."],
    ["sal-cancel", "Cancel kena bagitau at least 24 jam awal. Deposit bridal tak refundable, tapi boleh tukar tarikh sekali."],
    ["sal-pay", "Terima cash, DuitNow QR, TnG eWallet, kad debit. Kad kredit tak terima. No instalment."],
    ["sal-member", "Member card RM30 setahun: 10% off semua servis kecuali bridal & produk. Birthday month free hair treatment basic."],
    ["sal-student", "Student discount 15% hari Selasa–Khamis, tunjuk kad pelajar. Tak boleh combine dgn member discount."],
    ["sal-home", "Home service utk bridal sahaja, area Bangi/Kajang/Putrajaya free transport, luar area caj RM1/km."],
  ]),

  // ───────── Aircon: CoolBro Aircond Services ─────────
  ...seg("aircon", "Info syarikat", [
    ["ac-hours", "Operasi Isnin–Sabtu 9am–6pm. Ahad & PH by appointment je, surcharge RM30."],
    ["ac-area", "Cover area: Shah Alam, Klang, Subang, PJ, Puchong. Luar area (KL, Cheras, Kajang) tambah transport RM20-RM40. Tak cover Seremban/Rawang."],
    ["ac-contact", "Call/WhatsApp 012-555 0177 (Abang Zul). Office: 27, Jalan Tukul P15/P, Seksyen 15, 40200 Shah Alam."],
    ["ac-zh", "可以用华语联络阿明 012-555 0178。冷气不冷、漏水都可以修。"],
    ["ac-brands", "Servis semua brand: Daikin, Panasonic, York, Midea, Acson, Mitsubishi, Sharp, Gree. Inverter & non-inverter ok."],
    ["ac-booking", "Booking sehari awal paling selamat. Same day kalau ada slot, tambah RM20 urgent."],
    ["ac-pay", "Bayar lepas siap kerja: cash, online transfer, DuitNow QR. Company — 14 days term dgn PO."],
    ["ac-warranty", "Warranty servis 30 hari. Installation workmanship 6 bulan. Unit baru ikut manufacturer: compressor 5 tahun, parts 1 tahun."],
    ["ac-highrise", "Condo/apartment: outdoor unit tingkat tinggi tanpa ledge, perlu skylift/gondola – customer arrange, kami tak provide. Kena dapat permit management dulu."],
  ]),
  ...seg("aircon", "Harga servis", [
    ["ac-normal", "Normal service (cuci biasa) wall unit: 1.0-1.5HP RM80/unit, 2.0-2.5HP RM100/unit. 3 unit ke atas less RM10 seunit."],
    ["ac-chem", "Chemical wash wall unit: 1.0HP RM130, 1.5HP RM150, 2.0HP RM180, 2.5HP RM200. Chemical overhaul (turun unit) tambah RM80."],
    ["ac-cassette", "Cassette / ceiling type: normal service RM150, chemical RM280-RM350 ikut HP."],
    ["ac-gas", "Top up gas: R22 RM80, R410A RM120, R32 RM100 (per unit, up to 30psi). Kalau bocor kena repair dulu, top up je tak tahan lama."],
    ["ac-leak", "Leak repair/brazing RM150-RM250 + gas. Check leaking pakai nitrogen pressure test RM80."],
    ["ac-install", "Installation new unit: 1.0-1.5HP RM250, 2.0-2.5HP RM300, incl 10ft copper piping, bracket, wiring. Extra piping RM18/ft. Tebuk dinding incl."],
    ["ac-dismantle", "Dismantle (buka) RM80/unit, relocate (buka+pasang) RM300/unit."],
    ["ac-inspect", "Inspection/troubleshoot charge RM50, waived kalau proceed repair."],
    ["ac-contract", "Contract servis utk office/kedai: setiap 3 bulan, RM65/unit (min 5 unit). Invoice company boleh, SST registered."],
    ["ac-time", "Normal service ambil 30-40 min seunit, chemical wash 1-1.5 jam."],
    ["ac-freq", "Disyorkan servis setiap 3-4 bulan utk rumah, sebulan sekali utk kedai makan."],
  ]),
  ...seg("aircon", "Masalah biasa & repair", [
    ["ac-water", "Aircond leaking air (water dripping) – biasanya drain pipe tersumbat. Servis + clear drain RM100. Kalau tray pecah, tukar tray RM120-RM180."],
    ["ac-notcold", "Tak sejuk: selalunya sebab kotor atau gas kurang. Kami check dulu (RM50), then quote. Compressor rosak — repair RM450-RM900 depends model."],
    ["ac-pcb", "PCB board repair RM180-RM350. Tukar remote universal RM35. Tukar capacitor RM90. Fan motor indoor RM220-RM320."],
    ["ac-noise", "Bunyi bising: fan blower kotor atau bearing haus. Blower cuci incl dlm chemical wash. Tukar bearing RM120."],
    ["ac-smell", "Bau busuk — kulat dlm coil; chemical wash + anti-bacterial spray RM20 tambahan."],
  ]),
  ...seg("aircon", "Unit baru", [
    ["ac-sell-1", "Daikin 1.0HP non-inverter FTV28P — RM1,250 incl install."],
    ["ac-sell-2", "Daikin 1.5HP inverter FTKF35 — RM1,950 incl install."],
    ["ac-sell-3", "Panasonic 1.0HP inverter CS-PU9XKH — RM1,680 incl install."],
    ["ac-sell-4", "Midea 1.0HP non-inverter MSXD-09 — RM990 incl install."],
    ["ac-sell-5", "Midea 1.5HP inverter MSXS-13 — RM1,450 incl install."],
  ]),

  // ───────── Tuition: Pusat Tuisyen Bestari Minda ─────────
  ...seg("tuition", "Info pusat", [
    ["tu-hours", "Waktu kelas: Isnin–Jumaat 3pm–10pm, Sabtu & Ahad 9am–6pm. Kaunter tutup hari Jumaat 12.30–2.45pm."],
    ["tu-addr", "No. 8-1 & 8-2, Jalan Reko Sentral 4, 43000 Kajang (tingkat 1, atas kedai runcit 99)."],
    ["tu-contact", "Cikgu Farah (admin) 013-555 0126. Email admin@bestariminda.example"],
    ["tu-teachers", "Cikgu: Mr. Tan (Add Maths/Physics, 15 tahun pengalaman, ex-guru sekolah), Cikgu Farah (BM/Sejarah), Ms. Priya (English), Cikgu Hafiz (Chemistry/Biology), Teacher Wong (Math primary & 华文)."],
    ["tu-class-size", "Max 12 pelajar satu kelas. Kelas 1.5 jam, sekali seminggu setiap subjek. SPM Add Maths 2 kali seminggu."],
    ["tu-age", "Tak terima tadika/prasekolah. Paling muda Tahun 1."],
    ["tu-transport", "Transport/van tak disediakan. Parents drop-off kat depan, jangan block kedai sebelah."],
    ["tu-result", "Keputusan SPM 2025: 18 dari 42 pelajar dapat A utk Add Maths."],
    ["tu-waiting", "Kelas Add Maths Form 5 dah penuh — waiting list. Form 4 ada kosong lagi."],
  ]),
  ...seg("tuition", "Yuran", [
    ["tu-fee-primary", "Yuran sekolah rendah (Tahun 1-6): RM60/subjek sebulan. Ambil 3 subjek RM160, 4 subjek RM200. Subjek: BM, BI, Math, Sains."],
    ["tu-fee-lower", "Form 1-3: RM80/subject per month. Package 4 subjects RM280. Subjects: BM, English, Maths, Science, Sejarah, Geografi."],
    ["tu-fee-upper", "Form 4-5 (SPM): RM100/subjek. Add Maths, Physics, Chemistry, Biology, Akaun RM120/subjek. Package 5 subjek RM480."],
    ["tu-reg", "Yuran pendaftaran RM50 (sekali je), yuran bahan/nota RM30 setahun. Adik-beradik: anak kedua diskaun 10%."],
    ["tu-1to1", "Personal 1-to-1: RM50/jam (primary), RM70/jam (secondary). Home tuition tak buat."],
    ["tu-chinese", "华文补习：一年级到六年级，每月 RM70，星期日上午 11 点，Teacher Wong 教。"],
    ["tu-igcse", "IGCSE / international syllabus: Maths & Science sahaja (Year 7-9), RM150/subject."],
    ["tu-seminar", "Seminar intensif SPM (Oktober): RM150 sehari, 9am-5pm, incl lunch & modul. Subjek: Add Maths, Sejarah, BM."],
    ["tu-holiday-prog", "Holiday programme Disember: 'Headstart Form 1' 2 minggu RM350; kem membaca Tahun 1 RM200."],
  ]),
  ...seg("tuition", "Jadual", [
    ["tu-schedule-spm", "Jadual SPM: Add Maths Selasa & Khamis 8-9.30pm; Physics Rabu 8pm; Chemistry Isnin 8pm; Biology Sabtu 10am; BM Sabtu 2pm; Sejarah Ahad 10am."],
    ["tu-schedule-pt3", "Form 1-3: Maths Isnin 5pm, Science Rabu 5pm, English Jumaat 5pm, BM Sabtu 11.30am."],
    ["tu-schedule-primary", "Tahun 4-6: Math Selasa 3.30pm, Sains Khamis 3.30pm, BI Sabtu 9am. Tahun 1-3: Sabtu & Ahad pagi sahaja."],
    ["tu-online", "Online class via Google Meet available for Form 4-5 only, same fee. Recording disimpan 7 hari."],
    ["tu-trial", "Free trial 1 kelas utk pelajar baru. Kena book dulu."],
  ]),
  ...seg("tuition", "Peraturan", [
    ["tu-pay", "Bayar sebelum 7hb setiap bulan. Lewat lepas 15hb denda RM10. Online transfer / DuitNow / cash di kaunter. No refund kalau ponteng."],
    ["tu-replace", "Ganti kelas: kalau tak hadir sebab sakit (ada MC), boleh join kelas lain dlm minggu sama. Maximum 2 kali sebulan."],
    ["tu-withdraw", "Berhenti kena notis sebulan. Deposit takde."],
    ["tu-holiday", "Cuti sekolah: kelas jalan macam biasa. Tutup seminggu masa Raya dan CNY; yuran bulan tu tetap sama."],
    ["tu-exam", "Ujian bulanan setiap hujung bulan, report hantar ke WhatsApp parents. Parents meeting 2 kali setahun."],
    ["tu-materials", "Nota & latihan disediakan. Buku rujukan beli sendiri — list diberi masa daftar."],
  ]),

  // ───────── Auto parts: Maju Jaya Auto Parts (shop facts; catalogue is separate) ─────────
  ...seg("auto", "Info kedai", [
    ["au-hours", "Buka Isnin–Sabtu 8.30am–6.30pm, Ahad 9am–1pm. PH tutup."],
    ["au-addr", "Lot 5, Jalan Sungai Rasau Kiri, Kawasan Perindustrian Rasau, 41300 Klang."],
    ["au-contact", "Kaunter 03-5550 0193, WhatsApp order 016-555 0193 (Ah Seng / Raju)."],
    ["au-zh", "老板会讲华语和福建话。可以 WhatsApp 报车型和年份询价。"],
    ["au-install", "Kami kedai spare part je, tak pasang. Boleh recommend bengkel sebelah (Bengkel Ah Fatt) — upah asing."],
    ["au-oe", "Gred barang: 'ori' = original pengeluar kereta; OEM = kilang sama tanpa logo; aftermarket = brand Nexa/Kyoro/ProGrip, lebih murah."],
    ["au-chassis", "Tak pasti part? Hantar gambar geran atau chassis number kat WhatsApp, kami check."],
  ]),
  ...seg("auto", "Polisi kedai", [
    ["au-delivery", "Delivery Klang area free utk order RM150 ke atas, bawah tu caj RM8. Lalamove ke luar Klang customer tanggung. Pos Laju/J&T seluruh Malaysia RM10-RM25 ikut berat."],
    ["au-return", "Barang boleh tukar dlm 7 hari dgn resit, belum pasang & kotak elok. Electrical parts (sensor, coil, ECU) tak boleh return. Refund tak ada, tukar barang/credit note je."],
    ["au-warranty", "Warranty: absorber 6 bulan, bateri 12 bulan (jenis MF), clutch kit 3 bulan, barang 'ori' ikut pengeluar. Brake pad no warranty."],
    ["au-pay", "Cash, online transfer, DuitNow QR, kad kredit (min RM50). Workshop account 30 hari — kena register dgn SSM."],
    ["au-stock", "Kalau takde stok, order ambil masa 1-3 hari bekerja. Deposit 50% utk barang order khas."],
    ["au-wholesale", "Harga borong utk bengkel: less 8-12% ikut volume, min order RM500 sebulan."],
    ["au-battery-svc", "Tukar bateri kat kedai free pasang. Bateri lama trade-in tolak RM20."],
  ]),
];

export const CATALOGUE_DOC = "Senarai harga spare part";
export const CATALOGUE_HEADER = "Part No | Barang | Kereta | Brand | Harga | Stok";
