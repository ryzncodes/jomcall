// Copy for the side panel of the sign-up and log-in screens. The six steps use
// the same names as the in-app checklist (web/components/core/home/home.tsx), so
// the promise made before sign-up matches what the owner sees after it. A test
// keeps the two lists equal. No wait time is stated for the phone number.
export const authPanel = {
  heading: [
    "Your AI receptionist, in six steps.",
    "Penyambut tetamu AI anda, dalam enam langkah.",
  ],
  intro: [
    "JomCall is an AI receptionist for your business phone line. It answers calls in Bahasa Melayu, English, Manglish or Mandarin, answers questions about your business, takes messages and passes the caller to your staff during opening hours.",
    "JomCall ialah penyambut tetamu AI untuk talian telefon perniagaan anda. Ia menjawab panggilan dalam BM, bahasa Inggeris, Manglish atau Mandarin, menjawab soalan tentang perniagaan anda, mengambil pesanan dan menyambungkan pemanggil kepada staf anda dalam waktu operasi.",
  ],
  stepsLabel: ["The six steps", "Enam langkah"],
  steps: [
    ["Set up your business", "Sediakan perniagaan anda"],
    ["Test the agent", "Uji ejen"],
    ["Publish the agent", "Terbitkan ejen"],
    ["Choose a plan", "Pilih pelan"],
    ["Get a phone number", "Dapatkan nombor telefon"],
    ["Take your first real call", "Terima panggilan sebenar pertama"],
  ],
} as const;
