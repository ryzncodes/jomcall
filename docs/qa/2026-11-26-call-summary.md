# Call summary paid check, 2026-11-26

- Date: 2026-11-26 (Asia/Kuala_Lumpur).
- Model: `claude-haiku-5-5` through the Anthropic API, one request per case, 20 s timeout.
- Command: `npm run check:call-summary -- --paid` (run as `node --conditions=react-server --env-file-if-exists=.env.local --env-file-if-exists=<main checkout>/.env.hosted --import tsx scripts/calls/check-summary.ts --paid` from the worktree, because the key lives in the main checkout's gitignored `.env.hosted`).
- Code: branch `feat/call-summary` at `03e783d` (guard round 3).
- Cases: `scripts/calls/summary-cases.json`, 16 made-up calls (4 each in BM, English, Manglish, Mandarin). All names, numbers, IC numbers, addresses and emails are fake.
- Result: **16 of 16 passed**. No `QUOTE`, `PERSONAL_DETAIL`, `FALSE_SUCCESS`, `INVALID_OUTPUT`, model failure or timeout; every reason contained an expected keyword; no case's forbidden caller detail (names, street, estate, email local part) appeared in any field.
- Run once. Raw output: `output/call-summary/2026-11-26T09-11-22-674Z.json` (gitignored).
- Read by a person: not yet. The owner should read the 16 summaries below before `JOMCALL_CALL_SUMMARY=anthropic` is set anywhere (RUNBOOK step 19).

## What this proves and what it does not

- Proves: on these 16 made-up calls, one run of the current prompt and guards produced summaries that passed every code check, so the guards did not reject a good answer here.
- Does not prove: accuracy on real callers, real noise or long calls; how often a rerun would differ; that names and addresses never leak (the prompt keeps them out; the code guard only catches digits, IC patterns, emails and the caller's number); false-success wording outside the guard's phrase families.

## Outputs

### c01 (ms): pass

- `reason_en`: Caller wanted to book an air-conditioner service for their home on Saturday.
- `reason_ms`: Pemanggil mahu membuat temu janji untuk servis penyaman udara di rumahnya pada hari Sabtu.
- `outcome_en`: Caller asked to book a Saturday morning slot at ten o'clock and gave their name for it; the booking request is pending staff confirmation.
- `outcome_ms`: Pemanggil meminta temu janji pada pagi Sabtu jam sepuluh dan memberikan namanya; permintaan tempahan itu menunggu pengesahan daripada staf.
- `next_step_en`: Staff should confirm the Saturday morning ten o'clock air-conditioner service booking with the caller.
- `next_step_ms`: Staf perlu mengesahkan temu janji servis penyaman udara pada pagi Sabtu jam sepuluh dengan pemanggil.

### c02 (ms): pass

- `reason_en`: The caller wanted a specific staff member to call them back about an invoice from last month.
- `reason_ms`: Pemanggil mahu seorang staf tertentu menghubungi mereka semula mengenai invois bulan lepas.
- `outcome_en`: The caller left a message for the requested staff member asking for a callback about the invoice.
- `outcome_ms`: Pemanggil meninggalkan pesanan untuk staf yang diminta supaya dihubungi semula mengenai invois tersebut.
- `next_step_en`: Pass the message to the requested staff member so they can call the caller back about last month's invoice.
- `next_step_ms`: Sampaikan pesanan itu kepada staf yang diminta supaya mereka dapat menghubungi pemanggil semula mengenai invois bulan lepas.

### c03 (ms): pass

- `reason_en`: Caller asked for a manager because of a problem with a delivery of their goods.
- `reason_ms`: Pemanggil mahu bercakap dengan pengurus kerana masalah penghantaran barangnya.
- `outcome_en`: The call was transferred to staff and answered.
- `outcome_ms`: Panggilan telah disambungkan kepada staf dan dijawab.
- `next_step_en`: Staff who took the transfer should follow up on the caller's delivery problem.
- `next_step_ms`: Staf yang menerima panggilan ini perlu membantu pemanggil menyelesaikan masalah penghantaran barangnya.

### c04 (ms): pass

- `reason_en`: Reason unclear
- `reason_ms`: Sebab tidak jelas
- `outcome_en`: The caller did not state any request and ended the call after the agent asked how they could help.
- `outcome_ms`: Pemanggil tidak menyatakan sebarang keperluan dan menamatkan panggilan selepas ejen bertanya bagaimana boleh membantu.
- `next_step_en`: (none)
- `next_step_ms`: (none)

### c05 (en): pass

- `reason_en`: Caller asked about the price of a full home aircon service and whether the business services wall units.
- `reason_ms`: Pemanggil bertanya tentang harga servis penyaman udara rumah yang lengkap dan sama ada perniagaan ini menyediakan servis unit dinding.
- `outcome_en`: Agent gave the pricing for a wall unit service and a full chemical wash, and the caller said that was all they needed.
- `outcome_ms`: Ejen memberikan harga untuk servis unit dinding dan cucian kimia penuh, dan pemanggil berkata itu sahaja yang diperlukan.
- `next_step_en`: (none)
- `next_step_ms`: (none)

### c06 (en): pass

- `reason_en`: Caller wanted to complain that a technician damaged their cabinet last week and that their earlier emails had gone unanswered.
- `reason_ms`: Pemanggil ingin membuat aduan bahawa seorang juruteknik merosakkan kabinet mereka minggu lepas dan emel terdahulu mereka belum dibalas.
- `outcome_en`: The agent apologised and flagged the complaint for a staff member, and told the caller it was marked for a callback.
- `outcome_ms`: Ejen memohon maaf dan menandakan aduan itu untuk kakitangan, serta memberitahu pemanggil bahawa ia telah ditandakan untuk panggilan balik.
- `next_step_en`: Staff should call the caller back to follow up on the damaged cabinet complaint, as they asked for a call this time.
- `next_step_ms`: Kakitangan perlu menelefon semula pemanggil untuk menyambung aduan kabinet yang rosak, kerana pemanggil meminta panggilan kali ini.

### c07 (en): pass

- `reason_en`: Caller rang after hours asking for someone to look at a leaking pipe the next morning.
- `reason_ms`: Pemanggil menelefon di luar waktu pejabat untuk meminta seseorang memeriksa paip yang bocor pada pagi esok.
- `outcome_en`: Caller left a message with their name for the team to call back in the morning.
- `outcome_ms`: Pemanggil meninggalkan mesej dengan namanya supaya pasukan menelefon balik pada waktu pagi.
- `next_step_en`: Call the caller back tomorrow morning to arrange for someone to look at the leaking pipe.
- `next_step_ms`: Telefon semula pemanggil esok pagi untuk mengatur seseorang memeriksa paip yang bocor.

### c08 (en): pass

- `reason_en`: Caller wanted to register for the service plan.
- `reason_ms`: Pemanggil mahu mendaftar untuk pelan perkhidmatan.
- `outcome_en`: Caller gave identity, address and email details, and a message was left for staff to follow up.
- `outcome_ms`: Pemanggil memberikan butiran identiti, alamat dan emel, dan pesanan ditinggalkan untuk kakitangan membuat susulan.
- `next_step_en`: Staff should follow up with the caller to complete their service plan registration.
- `next_step_ms`: Kakitangan perlu membuat susulan dengan pemanggil untuk melengkapkan pendaftaran pelan perkhidmatan mereka.

### c09 (manglish): pass

- `reason_en`: Asked to book a haircut slot for Friday afternoon.
- `reason_ms`: Minta tempahan slot potong rambut pada petang Jumaat.
- `outcome_en`: The agent noted the request for Friday at four in the afternoon for staff to confirm later.
- `outcome_ms`: Ejen mencatatkan permintaan untuk Jumaat pukul empat petang supaya staf dapat mengesahkannya kemudian.
- `next_step_en`: Staff should confirm the Friday afternoon haircut slot with the caller.
- `next_step_ms`: Staf perlu mengesahkan slot potong rambut pada petang Jumaat dengan pemanggil.

### c10 (manglish): pass

- `reason_en`: Caller received the wrong item in last week's order and wanted someone to sort it out without having to keep chatting.
- `reason_ms`: Pemanggil menerima barang yang salah dalam pesanan minggu lepas dan mahu seseorang menyelesaikannya tanpa perlu terus berbual.
- `outcome_en`: Agent apologised and handed the call over, leaving a message for staff to call the caller back.
- `outcome_ms`: Ejen memohon maaf dan menyerahkan panggilan, dengan meninggalkan mesej untuk staf menghubungi semula pemanggil.
- `next_step_en`: Call the caller back to resolve the wrong item received in last week's order.
- `next_step_ms`: Hubungi semula pemanggil untuk menyelesaikan barang yang salah diterima dalam pesanan minggu lepas.

### c11 (manglish): pass

- `reason_en`: Caller asked how much it costs to replace the battery in their old iPhone and whether it could be done.
- `reason_ms`: Pemanggil bertanya berapa kos menukar bateri iPhone lama mereka dan sama ada ia boleh dibuat.
- `outcome_en`: Agent gave a starting price that depends on the phone model, and the caller said they would think about it first.
- `outcome_ms`: Ejen memberi harga permulaan yang bergantung pada model telefon, dan pemanggil berkata akan fikirkan dahulu.
- `next_step_en`: (none)
- `next_step_ms`: (none)

### c12 (manglish): pass

- `reason_en`: The caller wanted to register for a yoga class.
- `reason_ms`: Pemanggil mahu mendaftar untuk kelas yoga.
- `outcome_en`: The caller left a message for staff with their identity and address details for registration, plus an email address for follow-up.
- `outcome_ms`: Pemanggil meninggalkan mesej untuk staf dengan butiran pengenalan dan alamat untuk pendaftaran, serta alamat e-mel untuk tindakan susulan.
- `next_step_en`: Contact the caller by email to complete the yoga class registration and verify the details they provided.
- `next_step_ms`: Hubungi pemanggil melalui e-mel untuk melengkapkan pendaftaran kelas yoga dan sahkan butiran yang diberikan.

### c13 (zh): pass

- `reason_en`: Caller wanted the manager to call them back about a quotation from last month.
- `reason_ms`: Pemanggil mahu pengurus menelefon balik mengenai sebut harga dari bulan lepas.
- `outcome_en`: Caller left a message for staff asking the manager to call back tomorrow, and gave their name.
- `outcome_ms`: Pemanggil meninggalkan pesanan untuk kakitangan meminta pengurus menelefon balik esok, dan memberikan nama mereka.
- `next_step_en`: Pass the message to the manager so they can call the caller back tomorrow about last month's quotation.
- `next_step_ms`: Sampaikan pesanan kepada pengurus supaya beliau boleh menelefon pemanggil balik esok mengenai sebut harga bulan lepas.

### c14 (zh): pass

- `reason_en`: Caller rang after hours to ask whether they could come in tomorrow to look at a car.
- `reason_ms`: Pemanggil menelefon di luar waktu pejabat untuk bertanya sama ada boleh datang esok untuk melihat kereta.
- `outcome_en`: Caller was told the office was closed and left a message for staff, who will follow up when the office reopens.
- `outcome_ms`: Pemanggil dimaklumkan pejabat sudah tutup dan meninggalkan pesanan untuk kakitangan, yang akan membuat susulan selepas pejabat dibuka semula.
- `next_step_en`: Call the caller back tomorrow after opening to arrange a time for them to view the car.
- `next_step_ms`: Hubungi semula pemanggil esok selepas pejabat dibuka untuk menetapkan masa mereka melihat kereta.

### c15 (zh): pass

- `reason_en`: Caller wanted to reach a repair technician because the air conditioner at home keeps dripping water and they consider it urgent.
- `reason_ms`: Pemanggil mahu berhubung dengan juruteknik pembaikan kerana penyaman udara di rumahnya asyik menitik air dan mereka menganggapnya mendesak.
- `outcome_en`: The agent transferred the call to staff, and the transfer was answered.
- `outcome_ms`: Ejen memindahkan panggilan kepada kakitangan, dan panggilan pindahan itu dijawab.
- `next_step_en`: Staff who took the transfer should follow up with the caller about the urgent air conditioner dripping problem.
- `next_step_ms`: Kakitangan yang menerima pindahan panggilan ini perlu membuat susulan dengan pemanggil mengenai masalah penyaman udara yang menitik air secara mendesak.

### c16 (zh): pass

- `reason_en`: Reason unclear; the caller checked whether the line was working and then said they no longer needed anything.
- `reason_ms`: Sebab tidak jelas; pemanggil memastikan talian berfungsi dan kemudian berkata tidak perlukan apa-apa lagi.
- `outcome_en`: The call was answered, but the caller ended it without stating a request.
- `outcome_ms`: Panggilan dijawab, tetapi pemanggil menamatkannya tanpa menyatakan sebarang permintaan.
- `next_step_en`: (none)
- `next_step_ms`: (none)

