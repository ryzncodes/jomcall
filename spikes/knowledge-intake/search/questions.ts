// 120 fake caller questions, 30 per language, each labelled with the knowledge
// unit(s) that hold the answer. `gold: []` means the answer is NOT in the knowledge.
import { pn, type Fit, type Part } from "./catalogue.ts";
import type { Biz } from "./knowledge.ts";

export type Lang = "bm" | "en" | "manglish" | "zh";
export type Kind =
  | "direct" // same language, close wording
  | "paraphrase" // same language, different wording
  | "cross" // question language differs from the knowledge language
  | "partno" // part-number lookup
  | "model" // model-name / catalogue item lookup
  | "stt" // misspelt the way speech-to-text would
  | "absent"; // not in the knowledge
export type Question = { id: number; lang: Lang; kind: Kind; biz: Biz; text: string; gold: string[]; catalogue: boolean };

const row = (fit: Fit, part: Part) => `cat:${fit}:${part}`;
const spaced = (s: string) => s.replace(/-/g, " ");
const nodash = (s: string) => s.replace(/-/g, "");
/** One wrong digit, as a caller misreading a label would give. */
const typo = (s: string) => s.replace(/\d(?=\D*$)/, (d) => String((Number(d) + 3) % 10));

const raw: [Lang, Kind, Biz, string, string[]][] = [
  // ───────────── Bahasa Melayu ─────────────
  ["bm", "direct", "salon", "Potong rambut perempuan berapa?", ["sal-cut-w"]],
  ["bm", "paraphrase", "salon", "Kedai tutup hari apa?", ["sal-hours"]],
  ["bm", "paraphrase", "salon", "Saya pakai tudung, ada tempat privasi tak untuk buat rambut?", ["sal-hijab"]],
  ["bm", "stt", "salon", "Ribonding rambut panjang berapa ringgit?", ["sal-rebond"]],
  ["bm", "cross", "salon", "Gunting rambut lelaki dengan basuh sekali harga berapa?", ["sal-cut-m"]],
  ["bm", "paraphrase", "salon", "Kalau saya tak jadi datang, kena beritahu bila?", ["sal-cancel"]],
  ["bm", "direct", "aircon", "Chemical wash 1.5HP berapa?", ["ac-chem"]],
  ["bm", "paraphrase", "aircon", "Aircond saya menitik air, boleh betulkan?", ["ac-water"]],
  ["bm", "cross", "aircon", "Berapa kos pasang aircond baru satu kuda?", ["ac-install"]],
  ["bm", "stt", "aircon", "Tambah gas R empat satu kosong A berapa?", ["ac-gas"]],
  ["bm", "paraphrase", "aircon", "Korang datang tak kawasan Puchong?", ["ac-area"]],
  ["bm", "model", "aircon", "Harga Daikin FTKF35 termasuk pasang?", ["ac-sell-2"]],
  ["bm", "direct", "tuition", "Yuran pendaftaran berapa?", ["tu-reg"]],
  ["bm", "paraphrase", "tuition", "Anak saya darjah 5, sebulan kena bayar berapa satu subjek?", ["tu-fee-primary"]],
  ["bm", "cross", "tuition", "Tingkatan 2 ambil empat subjek berapa?", ["tu-fee-lower"]],
  ["bm", "stt", "tuition", "Kelas ad mat SPM hari apa?", ["tu-schedule-spm"]],
  ["bm", "paraphrase", "tuition", "Kalau anak demam tak datang kelas, boleh ganti tak?", ["tu-replace"]],
  ["bm", "cross", "tuition", "Ada kelas dalam talian tak?", ["tu-online"]],
  ["bm", "paraphrase", "auto", "Barang dah beli boleh pulang balik tak?", ["au-return"]],
  ["bm", "direct", "auto", "Ahad buka pukul berapa?", ["au-hours"]],
  ["bm", "partno", "auto", `Ada stok ${pn("myvi-g3", "bpf")}?`, [row("myvi-g3", "bpf")]],
  ["bm", "partno", "auto", `Nombor part ${spaced(pn("saga-blm", "tb"))} harga berapa?`, [row("saga-blm", "tb")]],
  ["bm", "model", "auto", "Pam air Wira berapa?", [row("wira", "wp")]],
  ["bm", "model", "auto", "Absorber depan Bezza sebiji berapa?", [row("bezza", "abf")]],
  ["bm", "stt", "auto", "Bes pad depan vi os NCP 150 ada?", [row("vios-ncp150", "bpf")]],
  ["bm", "model", "auto", "Minyak hitam fully synthetic 5W-30 4 liter berapa?", ["cat:u:eo-5w30"]],
  ["bm", "absent", "salon", "Ada jual rambut palsu atau wig tak?", []],
  ["bm", "absent", "aircon", "Boleh servis peti sejuk tak?", []],
  ["bm", "absent", "tuition", "Ada kelas mengaji Al-Quran tak?", []],
  ["bm", "absent", "auto", "Tayar Myvi saiz 175/65R14 ada jual?", []],

  // ───────────── English ─────────────
  ["en", "direct", "salon", "How much is a keratin treatment?", ["sal-keratin"]],
  ["en", "cross", "salon", "Are you open on Mondays?", ["sal-hours"]],
  ["en", "cross", "salon", "Can I pay by credit card?", ["sal-pay"]],
  ["en", "paraphrase", "salon", "I'm pregnant, is it safe to dye my hair there?", ["sal-color"]],
  ["en", "cross", "salon", "Do you do eyebrow threading and how much is it?", ["sal-wax"]],
  ["en", "stt", "salon", "How much for bally arch highlights?", ["sal-highlight"]],
  ["en", "direct", "aircon", "What is the inspection charge?", ["ac-inspect"]],
  ["en", "cross", "aircon", "My air conditioner is not cold, what could be wrong?", ["ac-notcold"]],
  ["en", "cross", "aircon", "How often should I service my aircon at home?", ["ac-freq"]],
  ["en", "paraphrase", "aircon", "Do you give any guarantee after servicing?", ["ac-warranty"]],
  ["en", "model", "aircon", "How much is the Panasonic CS-PU9XKH?", ["ac-sell-3"]],
  ["en", "cross", "aircon", "There's a bad smell coming from my aircon", ["ac-smell"]],
  ["en", "direct", "tuition", "Do you offer a free trial class?", ["tu-trial"]],
  ["en", "cross", "tuition", "How many students are in one class?", ["tu-class-size"]],
  ["en", "cross", "tuition", "What happens if I pay the fees late?", ["tu-pay"]],
  ["en", "paraphrase", "tuition", "Who teaches Additional Mathematics and how experienced is he?", ["tu-teachers"]],
  ["en", "cross", "tuition", "Do you accept kindergarten children?", ["tu-age"]],
  ["en", "stt", "tuition", "What time is the kimistry class for SPM?", ["tu-schedule-spm"]],
  ["en", "cross", "auto", "Do you install the parts for me?", ["au-install"]],
  ["en", "cross", "auto", "How long is the battery warranty?", ["au-warranty"]],
  ["en", "partno", "auto", `Do you have part number ${nodash(pn("city-gm6", "af")).toLowerCase()}?`, [row("city-gm6", "af")]],
  ["en", "partno", "auto", `Price for ${typo(pn("alza", "ck"))} please`, [row("alza", "ck")]],
  ["en", "model", "auto", "How much is a clutch kit for Proton Persona?", [row("persona", "ck")]],
  ["en", "model", "auto", "Rear brake shoes for Perodua Kancil, how much?", [row("kancil", "bsr")]],
  ["en", "stt", "auto", "Do you have time in belt for pro ton is wara?", [row("iswara", "tb")]],
  ["en", "model", "auto", "Cabin filter for Honda City 2016", [row("city-gm6", "cf")]],
  ["en", "absent", "salon", "Do you offer hair transplant or hair loss medication?", []],
  ["en", "absent", "aircon", "Can you repair my washing machine?", []],
  ["en", "absent", "tuition", "Do you have piano or music lessons?", []],
  ["en", "absent", "auto", "Do you sell parts for BMW 3 Series?", []],

  // ───────────── Manglish ─────────────
  ["manglish", "direct", "salon", "Wash and blow how much ah?", ["sal-wash"]],
  ["manglish", "paraphrase", "salon", "Eh weekend can walk in or not, or must book first?", ["sal-booking"]],
  ["manglish", "paraphrase", "salon", "Student got discount ka?", ["sal-student"]],
  ["manglish", "paraphrase", "salon", "Bridal makeup for nikah how much, need deposit ah?", ["sal-bridal"]],
  ["manglish", "stt", "salon", "Got do caroten treatment or not, how long can tahan?", ["sal-keratin"]],
  ["manglish", "cross", "salon", "Your stylist can speak Chinese or not?", ["sal-zh"]],
  ["manglish", "direct", "aircon", "Normal service 1HP how much one unit?", ["ac-normal"]],
  ["manglish", "paraphrase", "aircon", "Boss, my aircond bising gila, what problem ah?", ["ac-noise"]],
  ["manglish", "paraphrase", "aircon", "Can come today or not? Urgent la.", ["ac-booking"]],
  ["manglish", "paraphrase", "aircon", "Office got 8 units, got contract price?", ["ac-contract"]],
  ["manglish", "model", "aircon", "Midea 1.5HP inverter MSXS-13 berapa boss?", ["ac-sell-5"]],
  ["manglish", "stt", "aircon", "Cuci aircond jenis kaset siling berapa?", ["ac-cassette"]],
  ["manglish", "direct", "tuition", "SPM Add Maths one month how much?", ["tu-fee-upper"]],
  ["manglish", "paraphrase", "tuition", "My son Form 5 want to join Add Maths, still got place?", ["tu-waiting"]],
  ["manglish", "paraphrase", "tuition", "CNY you all close how long? Fee still same ka?", ["tu-holiday"]],
  ["manglish", "paraphrase", "tuition", "Got van pick up student or not?", ["tu-transport"]],
  ["manglish", "paraphrase", "tuition", "One to one tuition for secondary how much per hour?", ["tu-1to1"]],
  ["manglish", "cross", "tuition", "Got Mandarin tuition for primary school kids?", ["tu-chinese"]],
  ["manglish", "paraphrase", "auto", "Delivery to Klang free or not?", ["au-delivery"]],
  ["manglish", "paraphrase", "auto", "Workshop can get cheaper price or not?", ["au-wholesale"]],
  ["manglish", "partno", "auto", `Boss, ${pn("axia", "of")} got stock?`, [row("axia", "of")]],
  ["manglish", "partno", "auto", `${spaced(pn("vios-ncp93", "wp")).toLowerCase()} how much ah`, [row("vios-ncp93", "wp")]],
  ["manglish", "model", "auto", "Lower arm Saga BLM how much one side?", [row("saga-blm", "la")]],
  ["manglish", "model", "auto", "Myvi old model punya radiator berapa?", [row("myvi-lb", "rad")]],
  ["manglish", "stt", "auto", "Got drive shaf for asia or not?", [row("axia", "ds")]],
  ["manglish", "model", "auto", "Bateri NS60 berapa, got warranty?", ["cat:u:bat-ns60", "au-warranty"]],
  ["manglish", "absent", "salon", "Got do tattoo or eyebrow embroidery or not?", []],
  ["manglish", "absent", "aircon", "You all sell air cooler or stand fan ah?", []],
  ["manglish", "absent", "tuition", "Got swimming class for kids?", []],
  ["manglish", "absent", "auto", "Got sell motorcycle parts, EX5 chain sprocket?", []],

  // ───────────── Mandarin ─────────────
  ["zh", "cross", "salon", "女生剪头发多少钱？", ["sal-cut-w"]],
  ["zh", "cross", "salon", "你们星期一有开吗？", ["sal-hours"]],
  ["zh", "cross", "salon", "染发全头长发要多少钱？", ["sal-color"]],
  ["zh", "direct", "salon", "染发前需要做敏感测试吗？", ["sal-zh"]],
  ["zh", "cross", "salon", "可以用 Touch 'n Go 付款吗？", ["sal-pay"]],
  ["zh", "cross", "salon", "做指甲多少钱？手和脚一起", ["sal-nails"]],
  ["zh", "cross", "aircon", "冷气化学清洗 1 匹多少钱？", ["ac-chem"]],
  ["zh", "cross", "aircon", "安装新冷气 2 匹要多少钱？", ["ac-install"]],
  ["zh", "cross", "aircon", "冷气漏水要怎么处理？修理多少钱？", ["ac-water"]],
  ["zh", "direct", "aircon", "有会讲华语的人可以联络吗？", ["ac-zh"]],
  ["zh", "cross", "aircon", "你们有去蒲种吗？", ["ac-area"]],
  ["zh", "model", "aircon", "Daikin FTV28P 多少钱？", ["ac-sell-1"]],
  ["zh", "direct", "tuition", "华文补习多少钱一个月？", ["tu-chinese"]],
  ["zh", "cross", "tuition", "中四中五的物理补习费多少？", ["tu-fee-upper"]],
  ["zh", "cross", "tuition", "一班最多几个学生？", ["tu-class-size"]],
  ["zh", "cross", "tuition", "有没有一对一补习？", ["tu-1to1"]],
  ["zh", "cross", "tuition", "学校假期有上课吗？", ["tu-holiday"]],
  ["zh", "cross", "tuition", "报名费多少？", ["tu-reg"]],
  ["zh", "direct", "auto", "老板会讲华语吗？", ["au-zh"]],
  ["zh", "cross", "auto", "可以送货到巴生吗？运费多少？", ["au-delivery"]],
  ["zh", "cross", "auto", "买了的零件可以退货吗？", ["au-return"]],
  ["zh", "partno", "auto", `${pn("persona", "sp")} 有货吗？`, [row("persona", "sp")]],
  ["zh", "partno", "auto", `零件号码 ${nodash(pn("myvi-lb", "abr"))} 多少钱？`, [row("myvi-lb", "abr")]],
  ["zh", "model", "auto", "Myvi 2019 的前刹车片多少钱？", [row("myvi-g3", "bpf")]],
  ["zh", "model", "auto", "Vios NCP93 的水箱多少钱？", [row("vios-ncp93", "rad")]],
  ["zh", "model", "auto", "Saga VVT 的火花塞一套多少钱？", [row("saga-vvt", "sp")]],
  ["zh", "model", "auto", "Viva 的机油滤清器有吗？", [row("viva", "of")]],
  ["zh", "absent", "salon", "有没有做按摩或者足疗？", []],
  ["zh", "absent", "aircon", "可以修理热水器吗？", []],
  ["zh", "absent", "auto", "有卖 Mercedes 的零件吗？", []],
];

export const QUESTIONS: Question[] = raw.map(([lang, kind, biz, text, gold], i) => ({
  id: i + 1,
  lang,
  kind,
  biz,
  text,
  gold,
  // A "catalogue question" is one about the 300-row parts list (answerable or not).
  catalogue: biz === "auto" && (gold.some((g) => g.startsWith("cat:")) || (kind === "absent")),
}));
