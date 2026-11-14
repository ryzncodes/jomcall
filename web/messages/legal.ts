// Privacy notice, terms of use and footer text for the public site, in English
// and BM. Operator facts are not written here: the tokens {name}, {reg},
// {address} and {email} are filled from web/lib/operator.ts when rendered.
// Not reviewed by a lawyer; see docs/legal/README.md.

export type LegalSection = {
  heading: string;
  paragraphs: string[];
  list?: string[];
  after?: string[];
};

export type LegalDocument = {
  title: string;
  intro: string;
  effective: string;
  sections: LegalSection[];
};

export type LegalCopy = {
  privacy: LegalDocument;
  terms: LegalDocument;
  footer: {
    product: string;
    registration: string;
    licence: string;
    source: string;
    preview: string;
    contents: string;
  };
};

const en: LegalCopy = {
  footer: {
    product: "JomCall by {name}",
    registration: "SSM registration no. {reg}",
    licence: "Source-available under FSL-1.1-ALv2",
    source: "Source code on GitHub",
    preview: "Invitation-only preview",
    contents: "On this page",
  },
  privacy: {
    title: "Privacy notice",
    intro:
      "How JomCall handles personal data, written in plain language for Malaysia's Personal Data Protection Act 2010.",
    effective: "Effective {date}",
    sections: [
      {
        heading: "Where the service stands today",
        paragraphs: [
          "JomCall is in an invitation-only preview. It does not yet answer real customer calls or WhatsApp messages for any business. This notice describes how we handle personal data now and how we will handle it once businesses connect their phone lines and WhatsApp accounts.",
        ],
      },
      {
        heading: "Who we are",
        paragraphs: [
          "JomCall is a product of {name}, a business registered in Malaysia with the Companies Commission of Malaysia (SSM) under registration number {reg}. Our registered address is {address}.",
          "In this notice, “we”, “us” and “our” mean {name}. To contact us about personal data, email {email}.",
        ],
      },
      {
        heading: "Two kinds of data, two roles",
        paragraphs: [
          "Businesses use JomCall to answer their phone calls and WhatsApp messages with an AI agent. We handle personal data in two different roles:",
        ],
        list: [
          "On behalf of a business. When you call or message a business that uses JomCall, that business decides why and how your information is used. We process it for the business and on its instructions. The business is responsible for telling you about its own use of your data and for answering your requests.",
          "For ourselves. When you sign up for or use a JomCall account, or contact us, we decide how that information is used and we are responsible for it.",
        ],
      },
      {
        heading: "What we collect about callers and people who message",
        paragraphs: [
          "For people who call or message a business through JomCall, we may process:",
        ],
        list: [
          "your phone number or WhatsApp number and any name you give;",
          "the audio of the call while it is in progress, and a written transcript of what was said;",
          "WhatsApp messages you send and the replies sent to you;",
          "bookings you make, and messages you leave for the business's staff;",
          "your consent choices, including whether you have asked not to be contacted again.",
        ],
      },
      {
        heading: "What we collect about account holders",
        paragraphs: [
          "For the business owners and staff who use a JomCall account, we collect:",
        ],
        list: [
          "account details: name, email address, role and sign-in records;",
          "business settings and knowledge: business name, branches, opening hours, services, prices, answers and rules entered for the agent;",
          "usage and billing records: minutes, messages, wallet balance, top-ups and receipts;",
          "technical logs: dates and times, IP addresses, browser type and error records needed to run and secure the service.",
        ],
      },
      {
        heading: "Why we use it",
        paragraphs: [],
        list: [
          "to answer calls and messages for the business, give information, take bookings and messages, and pass a conversation to staff;",
          "to show the business its call log, transcripts, bookings and messages so staff can follow up;",
          "to run, secure and fix the service, and to prevent abuse;",
          "to manage accounts, measure usage and bill in Malaysian ringgit;",
          "to meet our legal obligations and respond to lawful requests.",
        ],
        after: [
          "We do not sell personal data. We do not use callers' conversations to advertise to them.",
        ],
      },
      {
        heading: "AI answers, and calls may be recorded",
        paragraphs: [
          "Calls and messages are answered by an AI agent, not a person. At the start of each call or conversation, the agent says or sends a short notice that it is an AI and that the conversation may be recorded or transcribed. Our terms require every business to keep this notice on. You can ask to speak to a member of staff, and the agent will pass on your request or take a message.",
        ],
      },
      {
        heading: "Who receives data, and transfer outside Malaysia",
        paragraphs: [
          "We use outside service providers to run JomCall. They process data only to provide their service to us. Several of them are located outside Malaysia, so personal data is transferred to and stored in other countries, including Singapore and the United States. By using a business's JomCall line you should expect your call or messages to be processed by these providers. The providers we use or will use, and what each receives:",
        ],
        list: [
          "Deepgram (United States): call audio, to turn speech into text.",
          "Anthropic (United States): conversation text and the business's knowledge, to write the agent's replies. On some text paths this goes through OpenRouter (United States) before it reaches the model.",
          "Google (United States and other locations): the agent's reply text, to turn it into speech. If a business switches on knowledge search, its knowledge text is also sent to Google to build a search index.",
          "Meta (WhatsApp; United States and other locations): WhatsApp messages and phone numbers, which pass through Meta's WhatsApp Business Platform.",
          "Supabase (database in Singapore): account records, business settings, transcripts, bookings, messages and consent records.",
          "Vercel: hosting of this website and the web app.",
          "A server provider in Singapore: runs the call-handling and agent services.",
          "Cloudflare: domain name and DNS, bot checks on sign-up and login, sending account emails, and storing encrypted database backups.",
          "Curlec (Malaysia), once payments are switched on: payment details for wallet top-ups. We do not store card numbers.",
        ],
        after: [
          "We may also disclose personal data when the law requires it, or to the business that a caller contacted.",
        ],
      },
      {
        heading: "How long we keep data",
        paragraphs: [
          "We keep personal data only as long as it is needed for the purposes above or as the law requires. A business can delete individual contacts and their linked records, including transcripts, bookings and messages, from its JomCall account. Deleted records may remain in encrypted backups for a limited time until those backups expire.",
          "We will publish a retention schedule, with specific periods for each kind of record, before JomCall opens to the public.",
        ],
      },
      {
        heading: "How we protect data",
        paragraphs: [
          "We take reasonable steps to protect personal data, including encrypted connections, access controls that keep each business's records separate, limited staff access, keeping service keys out of the code, and encrypted backups. No system is completely secure, and we cannot promise that data will never be lost or accessed without permission. If we learn of a breach that affects you, we will act on it and notify those we are required to.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: ["You can ask:"],
        list: [
          "for access to your personal data and a copy of it;",
          "for incorrect or incomplete data to be corrected;",
          "to withdraw your consent;",
          "to limit how your data is processed;",
          "for your data to be deleted;",
          "not to be contacted again (do not contact).",
        ],
        after: [
          "If you called or messaged a business, contact that business first, because it decides how your data is used. Businesses can export, correct and delete a person's records and switch on do-not-contact from their JomCall account. You can also email us at {email} and we will pass your request to the business and help it respond.",
          "Account holders can email {email} about their own data. We may need to confirm your identity before acting, and we will reply within the time the law allows. On WhatsApp, replying STOP records a do-not-contact request.",
        ],
      },
      {
        heading: "Children",
        paragraphs: [
          "JomCall is a service for businesses and is not meant for children. Accounts are for adults acting for a business. We do not knowingly collect children's data for our own purposes. If a child calls a business that uses JomCall, the business is responsible for that conversation.",
        ],
      },
      {
        heading: "Changes to this notice",
        paragraphs: [
          "We will update this notice as the service changes, for example when real calls begin or new providers are added. The date at the top shows when it last changed. We will tell account holders about significant changes by email or in the app.",
        ],
      },
      {
        heading: "Language",
        paragraphs: ["This notice is available in English and Bahasa Melayu."],
      },
    ],
  },
  terms: {
    title: "Terms of use",
    intro:
      "The terms for using JomCall during its invitation-only preview. Short and plain on purpose.",
    effective: "Effective {date}",
    sections: [
      {
        heading: "Who provides JomCall",
        paragraphs: [
          "JomCall is provided by {name} (SSM registration no. {reg}), {address}. By creating an account or using the service, you agree to these terms on behalf of yourself and the business you represent.",
        ],
      },
      {
        heading: "Preview stage",
        paragraphs: [
          "JomCall is in an invitation-only preview. Features may change, pause or be removed, and data in the preview may be reset. We do not promise any level of uptime or availability during the preview. Do not rely on JomCall as your only way to receive important calls.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: ["When you use JomCall you must:"],
        list: [
          "have a lawful basis to contact the people your agent calls or messages, and respect their do-not-contact choices;",
          "keep the AI and recording notice switched on;",
          "not use JomCall to send unsolicited marketing or bulk messages;",
          "not use JomCall for emergency services, or to give medical, legal, financial or other regulated advice;",
          "not use JomCall to deceive, harass or break the law, or to try to break or overload the service.",
        ],
        after: [
          "WhatsApp use must also follow Meta's own WhatsApp Business policies.",
        ],
      },
      {
        heading: "Your content and your callers' data",
        paragraphs: [
          "You are responsible for the knowledge, prices, rules and other content you give the agent, and for keeping it accurate and lawful. Your callers' personal data belongs to your business: you decide how it is used, and you must tell your callers how you handle it and answer their requests. We process it for you as described in our privacy notice.",
        ],
      },
      {
        heading: "AI answers can be wrong",
        paragraphs: [
          "The agent is an AI and can misunderstand or give incorrect answers. Check your call log and transcripts. A booking or order taken by the agent is a proposal until your staff confirm it.",
        ],
      },
      {
        heading: "Fees",
        paragraphs: [
          "Fees are as shown on our pricing page when you use the service. Usage, such as call minutes and messages, is charged in Malaysian ringgit (MYR) from a prepaid wallet. We will give notice in the app before changing prices.",
        ],
      },
      {
        heading: "Intellectual property",
        paragraphs: [
          "JomCall's source code is published under the Functional Source License, version 1.1, with Apache 2.0 as the future licence (FSL-1.1-ALv2). That licence governs the code. These terms govern your use of the hosted service. The JomCall name and logo are not licensed for your use. You keep ownership of your content and give us permission to use it only to provide the service to you.",
        ],
      },
      {
        heading: "Limitation of liability",
        paragraphs: [
          "The preview is provided “as is”. To the extent Malaysian law allows, we are not liable for indirect or consequential losses, such as lost bookings, lost profit or missed calls, and our total liability to you is limited to the fees you paid us in the three months before the claim. Nothing in these terms limits liability that cannot be limited by law.",
        ],
      },
      {
        heading: "Ending use",
        paragraphs: [
          "You can stop using JomCall and ask us to close your account at any time. We may suspend or close an account that breaks these terms or puts others at risk, and we may end the preview with reasonable notice. Unused prepaid wallet balance will be handled as set out in the app's billing terms when payments go live.",
        ],
      },
      {
        heading: "Governing law",
        paragraphs: [
          "These terms are governed by the laws of Malaysia, and the courts of Malaysia will decide any dispute.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: ["Questions about these terms: {email}."],
      },
    ],
  },
};

const ms: LegalCopy = {
  footer: {
    product: "JomCall oleh {name}",
    registration: "No. pendaftaran SSM {reg}",
    licence: "Sumber tersedia di bawah FSL-1.1-ALv2",
    source: "Kod sumber di GitHub",
    preview: "Pratonton dengan jemputan sahaja",
    contents: "Kandungan halaman",
  },
  privacy: {
    title: "Notis privasi",
    intro:
      "Cara JomCall mengendalikan data peribadi, dalam bahasa mudah, menurut Akta Perlindungan Data Peribadi 2010 Malaysia.",
    effective: "Berkuat kuasa {date}",
    sections: [
      {
        heading: "Status perkhidmatan sekarang",
        paragraphs: [
          "JomCall kini dalam pratonton dengan jemputan sahaja. Ia belum menjawab panggilan atau mesej WhatsApp pelanggan sebenar bagi mana-mana perniagaan. Notis ini menerangkan cara kami mengendalikan data peribadi sekarang, dan cara kami akan mengendalikannya apabila perniagaan menyambungkan talian telefon dan akaun WhatsApp mereka.",
        ],
      },
      {
        heading: "Siapa kami",
        paragraphs: [
          "JomCall ialah produk {name}, perniagaan yang berdaftar di Malaysia dengan Suruhanjaya Syarikat Malaysia (SSM) di bawah nombor pendaftaran {reg}. Alamat berdaftar kami ialah {address}.",
          "Dalam notis ini, “kami” bermaksud {name}. Untuk menghubungi kami tentang data peribadi, e-mel {email}.",
        ],
      },
      {
        heading: "Dua jenis data, dua peranan",
        paragraphs: [
          "Perniagaan menggunakan JomCall untuk menjawab panggilan telefon dan mesej WhatsApp mereka dengan ejen AI. Kami mengendalikan data peribadi dalam dua peranan yang berbeza:",
        ],
        list: [
          "Bagi pihak perniagaan. Apabila anda menelefon atau menghantar mesej kepada perniagaan yang menggunakan JomCall, perniagaan itu yang menentukan sebab dan cara maklumat anda digunakan. Kami memprosesnya untuk perniagaan itu dan mengikut arahannya. Perniagaan itu bertanggungjawab memaklumkan anda tentang penggunaan data anda dan menjawab permintaan anda.",
          "Untuk diri kami sendiri. Apabila anda mendaftar atau menggunakan akaun JomCall, atau menghubungi kami, kami yang menentukan cara maklumat itu digunakan dan kami bertanggungjawab ke atasnya.",
        ],
      },
      {
        heading: "Data yang kami kumpul tentang pemanggil dan penghantar mesej",
        paragraphs: [
          "Bagi orang yang menelefon atau menghantar mesej kepada perniagaan melalui JomCall, kami mungkin memproses:",
        ],
        list: [
          "nombor telefon atau nombor WhatsApp anda dan nama yang anda berikan;",
          "audio panggilan semasa panggilan berlangsung, dan transkrip bertulis perbualan itu;",
          "mesej WhatsApp yang anda hantar dan balasan kepada anda;",
          "tempahan yang anda buat, dan pesanan yang anda tinggalkan untuk kakitangan perniagaan;",
          "pilihan persetujuan anda, termasuk sama ada anda meminta supaya tidak dihubungi lagi.",
        ],
      },
      {
        heading: "Data yang kami kumpul tentang pemegang akaun",
        paragraphs: [
          "Bagi pemilik dan kakitangan perniagaan yang menggunakan akaun JomCall, kami mengumpul:",
        ],
        list: [
          "butiran akaun: nama, alamat e-mel, peranan dan rekod log masuk;",
          "tetapan dan pengetahuan perniagaan: nama perniagaan, cawangan, waktu operasi, perkhidmatan, harga, jawapan dan peraturan yang dimasukkan untuk ejen;",
          "rekod penggunaan dan bil: minit, mesej, baki dompet, tambah nilai dan resit;",
          "log teknikal: tarikh dan masa, alamat IP, jenis pelayar dan rekod ralat yang diperlukan untuk menjalankan dan melindungi perkhidmatan.",
        ],
      },
      {
        heading: "Tujuan kami menggunakannya",
        paragraphs: [],
        list: [
          "menjawab panggilan dan mesej bagi pihak perniagaan, memberi maklumat, mengambil tempahan dan pesanan, dan menyerahkan perbualan kepada kakitangan;",
          "menunjukkan log panggilan, transkrip, tempahan dan pesanan kepada perniagaan supaya kakitangan boleh membuat susulan;",
          "menjalankan, melindungi dan membaiki perkhidmatan, serta mencegah penyalahgunaan;",
          "mengurus akaun, mengukur penggunaan dan mengenakan bayaran dalam ringgit Malaysia;",
          "memenuhi tanggungjawab undang-undang kami dan menjawab permintaan yang sah.",
        ],
        after: [
          "Kami tidak menjual data peribadi. Kami tidak menggunakan perbualan pemanggil untuk mengiklankan apa-apa kepada mereka.",
        ],
      },
      {
        heading: "Jawapan oleh AI, dan panggilan mungkin dirakam",
        paragraphs: [
          "Panggilan dan mesej dijawab oleh ejen AI, bukan manusia. Pada awal setiap panggilan atau perbualan, ejen menyebut atau menghantar notis ringkas bahawa ia ialah AI dan perbualan itu mungkin dirakam atau ditranskripsi. Terma kami mewajibkan setiap perniagaan mengekalkan notis ini. Anda boleh meminta untuk bercakap dengan kakitangan, dan ejen akan menyampaikan permintaan anda atau mengambil pesanan.",
        ],
      },
      {
        heading: "Penerima data, dan pemindahan ke luar Malaysia",
        paragraphs: [
          "Kami menggunakan pembekal perkhidmatan luar untuk menjalankan JomCall. Mereka memproses data hanya untuk memberikan perkhidmatan mereka kepada kami. Beberapa daripada mereka berada di luar Malaysia, jadi data peribadi dipindahkan ke dan disimpan di negara lain, termasuk Singapura dan Amerika Syarikat. Apabila anda menggunakan talian JomCall sesebuah perniagaan, panggilan atau mesej anda akan diproses oleh pembekal ini. Pembekal yang kami gunakan atau akan gunakan, dan apa yang diterima oleh setiap satu:",
        ],
        list: [
          "Deepgram (Amerika Syarikat): audio panggilan, untuk menukar pertuturan kepada teks.",
          "Anthropic (Amerika Syarikat): teks perbualan dan pengetahuan perniagaan, untuk menulis balasan ejen. Bagi sesetengah laluan teks, data ini melalui OpenRouter (Amerika Syarikat) sebelum sampai kepada model.",
          "Google (Amerika Syarikat dan lokasi lain): teks balasan ejen, untuk menukarnya kepada suara. Jika perniagaan menghidupkan carian pengetahuan, teks pengetahuannya juga dihantar kepada Google untuk membina indeks carian.",
          "Meta (WhatsApp; Amerika Syarikat dan lokasi lain): mesej WhatsApp dan nombor telefon, yang melalui Platform WhatsApp Business milik Meta.",
          "Supabase (pangkalan data di Singapura): rekod akaun, tetapan perniagaan, transkrip, tempahan, pesanan dan rekod persetujuan.",
          "Vercel: pengehosan laman web ini dan aplikasi web.",
          "Pembekal pelayan di Singapura: menjalankan perkhidmatan pengendalian panggilan dan ejen.",
          "Cloudflare: nama domain dan DNS, semakan bot semasa pendaftaran dan log masuk, penghantaran e-mel akaun, dan penyimpanan sandaran pangkalan data yang disulitkan.",
          "Curlec (Malaysia), apabila pembayaran dihidupkan: butiran pembayaran untuk tambah nilai dompet. Kami tidak menyimpan nombor kad.",
        ],
        after: [
          "Kami juga mungkin mendedahkan data peribadi apabila dikehendaki oleh undang-undang, atau kepada perniagaan yang dihubungi oleh pemanggil.",
        ],
      },
      {
        heading: "Tempoh penyimpanan data",
        paragraphs: [
          "Kami menyimpan data peribadi hanya selama yang diperlukan untuk tujuan di atas atau seperti yang dikehendaki oleh undang-undang. Perniagaan boleh memadam kenalan dan rekod berkaitan, termasuk transkrip, tempahan dan pesanan, daripada akaun JomCall mereka. Rekod yang dipadam mungkin kekal dalam sandaran yang disulitkan untuk tempoh terhad sehingga sandaran itu tamat tempoh.",
          "Kami akan menerbitkan jadual penyimpanan, dengan tempoh khusus bagi setiap jenis rekod, sebelum JomCall dibuka kepada orang ramai.",
        ],
      },
      {
        heading: "Cara kami melindungi data",
        paragraphs: [
          "Kami mengambil langkah munasabah untuk melindungi data peribadi, termasuk sambungan yang disulitkan, kawalan akses yang mengasingkan rekod setiap perniagaan, akses kakitangan yang terhad, kunci perkhidmatan yang tidak disimpan dalam kod, dan sandaran yang disulitkan. Tiada sistem yang selamat sepenuhnya, dan kami tidak dapat menjamin data tidak akan hilang atau diakses tanpa kebenaran. Jika kami mengetahui pelanggaran yang menjejaskan anda, kami akan mengambil tindakan dan memaklumkan pihak yang wajib kami maklumkan.",
        ],
      },
      {
        heading: "Hak anda",
        paragraphs: ["Anda boleh meminta:"],
        list: [
          "akses kepada data peribadi anda dan salinannya;",
          "pembetulan data yang salah atau tidak lengkap;",
          "untuk menarik balik persetujuan anda;",
          "untuk mengehadkan cara data anda diproses;",
          "supaya data anda dipadam;",
          "supaya tidak dihubungi lagi (jangan hubungi).",
        ],
        after: [
          "Jika anda menelefon atau menghantar mesej kepada sesebuah perniagaan, hubungi perniagaan itu dahulu, kerana ia yang menentukan cara data anda digunakan. Perniagaan boleh mengeksport, membetulkan dan memadam rekod seseorang serta menghidupkan jangan hubungi daripada akaun JomCall mereka. Anda juga boleh e-mel kami di {email} dan kami akan menyampaikan permintaan anda kepada perniagaan itu dan membantunya menjawab.",
          "Pemegang akaun boleh e-mel {email} tentang data mereka sendiri. Kami mungkin perlu mengesahkan identiti anda sebelum bertindak, dan kami akan menjawab dalam tempoh yang dibenarkan oleh undang-undang. Di WhatsApp, membalas STOP merekodkan permintaan jangan hubungi.",
        ],
      },
      {
        heading: "Kanak-kanak",
        paragraphs: [
          "JomCall ialah perkhidmatan untuk perniagaan dan tidak ditujukan kepada kanak-kanak. Akaun adalah untuk orang dewasa yang bertindak bagi pihak perniagaan. Kami tidak sengaja mengumpul data kanak-kanak untuk tujuan kami sendiri. Jika kanak-kanak menelefon perniagaan yang menggunakan JomCall, perniagaan itu bertanggungjawab atas perbualan tersebut.",
        ],
      },
      {
        heading: "Perubahan pada notis ini",
        paragraphs: [
          "Kami akan mengemas kini notis ini apabila perkhidmatan berubah, contohnya apabila panggilan sebenar bermula atau pembekal baharu ditambah. Tarikh di bahagian atas menunjukkan bila notis ini terakhir diubah. Kami akan memaklumkan pemegang akaun tentang perubahan penting melalui e-mel atau dalam aplikasi.",
        ],
      },
      {
        heading: "Bahasa",
        paragraphs: [
          "Notis ini tersedia dalam Bahasa Melayu dan bahasa Inggeris.",
        ],
      },
    ],
  },
  terms: {
    title: "Terma penggunaan",
    intro:
      "Terma untuk menggunakan JomCall semasa pratonton dengan jemputan sahaja. Sengaja ringkas dan mudah.",
    effective: "Berkuat kuasa {date}",
    sections: [
      {
        heading: "Pembekal JomCall",
        paragraphs: [
          "JomCall dibekalkan oleh {name} (No. pendaftaran SSM {reg}), {address}. Dengan membuka akaun atau menggunakan perkhidmatan ini, anda bersetuju dengan terma ini bagi pihak diri anda dan perniagaan yang anda wakili.",
        ],
      },
      {
        heading: "Peringkat pratonton",
        paragraphs: [
          "JomCall kini dalam pratonton dengan jemputan sahaja. Ciri boleh berubah, dihentikan sementara atau dibuang, dan data dalam pratonton mungkin ditetapkan semula. Kami tidak menjanjikan apa-apa tahap masa operasi atau ketersediaan semasa pratonton. Jangan bergantung pada JomCall sebagai satu-satunya cara untuk menerima panggilan penting.",
        ],
      },
      {
        heading: "Penggunaan yang dibenarkan",
        paragraphs: ["Apabila menggunakan JomCall, anda mesti:"],
        list: [
          "mempunyai asas yang sah untuk menghubungi orang yang ditelefon atau dihantar mesej oleh ejen anda, dan menghormati pilihan jangan hubungi mereka;",
          "sentiasa menghidupkan notis AI dan rakaman;",
          "tidak menggunakan JomCall untuk menghantar pemasaran yang tidak diminta atau mesej pukal;",
          "tidak menggunakan JomCall untuk perkhidmatan kecemasan, atau untuk memberi nasihat perubatan, undang-undang, kewangan atau nasihat lain yang dikawal selia;",
          "tidak menggunakan JomCall untuk menipu, mengganggu atau melanggar undang-undang, atau untuk cuba merosakkan atau membebankan perkhidmatan.",
        ],
        after: [
          "Penggunaan WhatsApp juga mesti mematuhi polisi WhatsApp Business milik Meta.",
        ],
      },
      {
        heading: "Kandungan anda dan data pemanggil anda",
        paragraphs: [
          "Anda bertanggungjawab atas pengetahuan, harga, peraturan dan kandungan lain yang anda berikan kepada ejen, dan memastikannya tepat dan sah. Data peribadi pemanggil anda adalah milik perniagaan anda: anda yang menentukan cara ia digunakan, dan anda mesti memaklumkan pemanggil tentang cara anda mengendalikannya serta menjawab permintaan mereka. Kami memprosesnya untuk anda seperti yang diterangkan dalam notis privasi kami.",
        ],
      },
      {
        heading: "Jawapan AI boleh salah",
        paragraphs: [
          "Ejen ialah AI dan boleh salah faham atau memberi jawapan yang salah. Semak log panggilan dan transkrip anda. Tempahan atau pesanan yang diambil oleh ejen hanyalah cadangan sehingga disahkan oleh kakitangan anda.",
        ],
      },
      {
        heading: "Bayaran",
        paragraphs: [
          "Bayaran adalah seperti yang ditunjukkan di halaman harga kami semasa anda menggunakan perkhidmatan. Penggunaan, seperti minit panggilan dan mesej, dicaj dalam ringgit Malaysia (MYR) daripada dompet prabayar. Kami akan memberi notis dalam aplikasi sebelum mengubah harga.",
        ],
      },
      {
        heading: "Harta intelek",
        paragraphs: [
          "Kod sumber JomCall diterbitkan di bawah Functional Source License versi 1.1, dengan Apache 2.0 sebagai lesen masa hadapan (FSL-1.1-ALv2). Lesen itu mengawal kod. Terma ini mengawal penggunaan perkhidmatan yang dihoskan. Nama dan logo JomCall tidak dilesenkan untuk kegunaan anda. Anda kekal sebagai pemilik kandungan anda dan memberi kami kebenaran menggunakannya hanya untuk memberikan perkhidmatan kepada anda.",
        ],
      },
      {
        heading: "Had liabiliti",
        paragraphs: [
          "Pratonton disediakan “seadanya”. Setakat yang dibenarkan oleh undang-undang Malaysia, kami tidak bertanggungjawab atas kerugian tidak langsung atau berbangkit, seperti tempahan yang terlepas, kehilangan keuntungan atau panggilan yang tidak dijawab, dan jumlah liabiliti kami kepada anda terhad kepada bayaran yang anda bayar kepada kami dalam tiga bulan sebelum tuntutan. Tiada apa-apa dalam terma ini mengehadkan liabiliti yang tidak boleh dihadkan oleh undang-undang.",
        ],
      },
      {
        heading: "Menamatkan penggunaan",
        paragraphs: [
          "Anda boleh berhenti menggunakan JomCall dan meminta kami menutup akaun anda pada bila-bila masa. Kami boleh menggantung atau menutup akaun yang melanggar terma ini atau membahayakan orang lain, dan kami boleh menamatkan pratonton dengan notis yang munasabah. Baki dompet prabayar yang tidak digunakan akan dikendalikan mengikut terma bil dalam aplikasi apabila pembayaran dihidupkan.",
        ],
      },
      {
        heading: "Undang-undang yang terpakai",
        paragraphs: [
          "Terma ini dikawal oleh undang-undang Malaysia, dan mahkamah Malaysia akan memutuskan sebarang pertikaian.",
        ],
      },
      {
        heading: "Hubungi kami",
        paragraphs: ["Soalan tentang terma ini: {email}."],
      },
    ],
  },
};

export const legalCopy: Record<"en" | "ms", LegalCopy> = { en, ms };
