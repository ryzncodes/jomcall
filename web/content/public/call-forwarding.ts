// The call forwarding guide, in English and Bahasa Melayu (spec sections 3
// and 5). The codes and their meanings are the app's own, from
// web/components/core/phone.tsx (the single source); a test reads that file
// and checks they match. Lines and providers are described in general terms.
import type { Bilingual, FaqItem, PageCopy, Section } from "./types.ts";

// Start and stop codes for a mobile line, in the app's order.
export const FORWARD_CODES = [
  { id: "all", start: "**21*", stop: "##21#" },
  { id: "no-answer", start: "**61*", stop: "##61#" },
  { id: "busy", start: "**67*", stop: "##67#" },
] as const;

type CodeRow = { name: string; when: string };

export type ForwardingCopy = {
  page: PageCopy;
  codes: {
    heading: string;
    lead: string;
    start: string;
    stop: string;
    number: string;
    rows: CodeRow[];
    note: string;
  };
  choose: { heading: string; items: { name: string; body: string }[] };
  mobile: { heading: string; steps: string[] };
  office: Section;
  check: Section;
  faq: { heading: string; items: FaqItem[] };
};

const en: ForwardingCopy = {
  page: {
    title: "Call forwarding to JomCall: keep your number",
    description:
      "Keep your business number and forward its calls to your JomCall number. The phone codes for every call, unanswered calls and a busy line, how to stop forwarding, and what to do on an office line.",
    h1: "Keep your number. Forward its calls.",
    lead: "Your customers keep calling the number they know. You send that line's calls on to your JomCall number, and the agent answers them. Here is how, on a mobile line and on an office line.",
  },
  codes: {
    heading: "The three codes",
    lead: "On a mobile line, each kind of forwarding has a start code and a stop code. Type the start code, your JomCall number and #, then press call.",
    start: "Start",
    stop: "Stop",
    number: "your JomCall number",
    rows: [
      { name: "Every call", when: "Every call goes to JomCall. Your own phone does not ring." },
      { name: "Only when you do not answer", when: "Your phone rings first. If nobody picks up, the call goes on to JomCall." },
      { name: "Only when your line is busy", when: "While you are already on a call, the next caller goes to JomCall." },
    ],
    note: "The app shows your JomCall number once it is set up. Type it the local way, starting with 0, with no spaces.",
  },
  choose: {
    heading: "Which one to pick",
    items: [
      { name: "Every call", body: "When you want JomCall to take the line completely, for example after closing or on a day the counter is short of staff. Type the stop code when you want your own phone to ring again." },
      { name: "Only when you do not answer", body: "When you or your staff want to answer first, and JomCall should pick up the calls nobody gets to." },
      { name: "Only when your line is busy", body: "When calls mostly go unanswered because you are already talking to another customer." },
    ],
  },
  mobile: {
    heading: "On a mobile line",
    steps: [
      "Use the phone that holds the line your customers call.",
      "Open the keypad and type the start code, then your JomCall number, then #.",
      "Press call.",
      "To stop, type the matching stop code the same way and press call.",
    ],
  },
  office: {
    heading: "On an office or fixed line",
    body: [
      "Ask your line provider to switch on call forwarding to your JomCall number.",
      "If your office uses a phone system (a PBX), whoever looks after the system sets up the forwarding.",
    ],
  },
  check: {
    heading: "Check that it works",
    body: [
      "Call your own number from another phone. You should hear the agent, and the call then shows in your call log in the app.",
      "If a code is refused, your provider has to switch the service on for your line first.",
      "Your provider may charge you for forwarded calls. Ask them what forwarding costs on your plan.",
    ],
  },
  faq: {
    heading: "Questions",
    items: [
      {
        q: "Do I have to change my business number?",
        a: "No. You keep the number your customers know and forward its calls to your JomCall number.",
      },
      {
        q: "Will my own phone still ring?",
        a: "With the every-call code, no: calls go straight to JomCall. With the other two codes your phone rings first, or is busy, and only then does the call go to JomCall.",
      },
      {
        q: "How do I stop forwarding?",
        a: "Type the stop code that matches the start code you used and press call. For example, ##21# stops forwarding every call.",
      },
      {
        q: "Does my line provider charge for forwarded calls?",
        a: "It may; ask your provider. Separately, JomCall bills the time the agent spends on each call from your prepaid wallet, after your plan's included minutes.",
      },
    ],
  },
};

const ms: ForwardingCopy = {
  page: {
    title: "Pemajuan panggilan ke JomCall: kekalkan nombor anda",
    description:
      "Kekalkan nombor perniagaan anda dan majukan panggilannya ke nombor JomCall. Kod telefon untuk semua panggilan, panggilan yang tidak dijawab dan talian sibuk, cara menghentikan pemajuan, dan apa yang perlu dibuat bagi talian pejabat.",
    h1: "Kekalkan nombor anda. Majukan panggilannya.",
    lead: "Pelanggan terus menelefon nombor yang mereka kenal. Anda hantar panggilan talian itu ke nombor JomCall anda, dan ejen yang menjawabnya. Ini caranya, untuk talian mudah alih dan talian pejabat.",
  },
  codes: {
    heading: "Tiga kod",
    lead: "Bagi talian mudah alih, setiap jenis pemajuan ada kod mula dan kod henti. Taip kod mula, nombor JomCall anda dan #, kemudian tekan panggil.",
    start: "Mula",
    stop: "Henti",
    number: "nombor JomCall anda",
    rows: [
      { name: "Semua panggilan", when: "Semua panggilan pergi ke JomCall. Telefon anda sendiri tidak berdering." },
      { name: "Hanya apabila anda tidak menjawab", when: "Telefon anda berdering dahulu. Kalau tiada siapa angkat, panggilan diteruskan ke JomCall." },
      { name: "Hanya apabila talian anda sibuk", when: "Semasa anda sedang bercakap dalam panggilan lain, pemanggil seterusnya pergi ke JomCall." },
    ],
    note: "Aplikasi memaparkan nombor JomCall anda sebaik sahaja ia disediakan. Taip nombor itu cara tempatan, bermula dengan 0, tanpa jarak.",
  },
  choose: {
    heading: "Yang mana patut dipilih",
    items: [
      { name: "Semua panggilan", body: "Apabila anda mahu JomCall mengambil alih talian sepenuhnya, contohnya selepas waktu tutup atau pada hari kaunter tidak cukup staf. Taip kod henti apabila anda mahu telefon sendiri berdering semula." },
      { name: "Hanya apabila anda tidak menjawab", body: "Apabila anda atau staf mahu menjawab dahulu, dan JomCall mengangkat panggilan yang tiada siapa sempat jawab." },
      { name: "Hanya apabila talian anda sibuk", body: "Apabila banyak panggilan terlepas kerana anda sedang melayan pelanggan lain di telefon." },
    ],
  },
  mobile: {
    heading: "Talian mudah alih",
    steps: [
      "Guna telefon yang memegang talian yang pelanggan anda telefon.",
      "Buka pad kekunci dan taip kod mula, kemudian nombor JomCall anda, kemudian #.",
      "Tekan panggil.",
      "Untuk berhenti, taip kod henti yang sepadan dengan cara yang sama dan tekan panggil.",
    ],
  },
  office: {
    heading: "Talian pejabat atau talian tetap",
    body: [
      "Minta pembekal talian anda menghidupkan pemajuan panggilan ke nombor JomCall anda.",
      "Jika pejabat anda menggunakan sistem telefon (PBX), pihak yang menyelenggara sistem itu akan menetapkan pemajuan.",
    ],
  },
  check: {
    heading: "Semak sama ada ia berfungsi",
    body: [
      "Telefon nombor anda sendiri dari telefon lain. Anda patut mendengar ejen, dan panggilan itu kemudian dipaparkan dalam log panggilan dalam aplikasi.",
      "Jika kod ditolak, pembekal anda perlu menghidupkan perkhidmatan itu untuk talian anda dahulu.",
      "Pembekal anda mungkin mengenakan caj bagi panggilan yang dimajukan. Tanya mereka kos pemajuan bagi pelan anda.",
    ],
  },
  faq: {
    heading: "Soalan",
    items: [
      {
        q: "Perlukah saya tukar nombor perniagaan saya?",
        a: "Tidak. Anda kekalkan nombor yang pelanggan kenal dan majukan panggilannya ke nombor JomCall anda.",
      },
      {
        q: "Adakah telefon saya masih berdering?",
        a: "Dengan kod semua panggilan, tidak: panggilan terus ke JomCall. Dengan dua kod yang lain, telefon anda berdering dahulu atau sibuk, barulah panggilan pergi ke JomCall.",
      },
      {
        q: "Bagaimana cara menghentikan pemajuan?",
        a: "Taip kod henti yang sepadan dengan kod mula yang anda guna, kemudian tekan panggil. Contohnya, ##21# menghentikan pemajuan semua panggilan.",
      },
      {
        q: "Adakah pembekal talian mengenakan caj untuk panggilan yang dimajukan?",
        a: "Mungkin; tanya pembekal anda. Selain itu, JomCall mengenakan caj untuk masa ejen dalam setiap panggilan daripada dompet prabayar anda, selepas minit yang termasuk dalam pelan anda habis.",
      },
    ],
  },
};

export const forwarding: Bilingual<ForwardingCopy> = { en, ms };
