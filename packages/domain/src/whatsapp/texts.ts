// Fixed wording the WhatsApp channel sends without asking the model.
export type ChatLanguage = "ms" | "en" | "zh";

const language = (value: unknown): ChatLanguage =>
  value === "en" || value === "zh" ? value : "ms";

const disclosure: Record<ChatLanguage, string> = {
  ms: 'Anda sedang berbual dengan pembantu AI perniagaan ini. Taip "staf" pada bila-bila masa untuk bercakap dengan pekerja kami.',
  en: 'You are chatting with this business\'s AI assistant. Type "staff" at any time to reach a member of our team.',
  zh: "您正在与本商家的 AI 助理对话。随时输入“人工”即可联系我们的员工。",
};

// The business's own AI introduction wins when it has written one.
export function disclosureText(
  settings: Record<string, unknown> | undefined,
  preferred: unknown,
) {
  const own =
    typeof settings?.aiDisclosure === "string"
      ? settings.aiDisclosure.trim()
      : "";
  return own
    ? Array.from(own).slice(0, 300).join("")
    : disclosure[language(preferred)];
}

const optOut: Record<ChatLanguage, string> = {
  ms: "Baik, kami tidak akan menghantar mesej lagi kepada anda. Hantar mesej kepada kami bila-bila masa jika anda memerlukan bantuan.",
  en: "Understood. We will not send you further messages. Message us any time if you need help.",
  zh: "好的，我们不会再向您发送信息。如需帮助，请随时给我们留言。",
};
const unsupported: Record<ChatLanguage, string> = {
  ms: "Maaf, saya hanya boleh membaca mesej teks buat masa ini. Pekerja kami akan menyemak mesej anda.",
  en: "Sorry, I can only read text messages for now. A member of our team will look at your message.",
  zh: "抱歉，我目前只能阅读文字信息。我们的员工会查看您的信息。",
};

export function noticeText(
  kind: "notice_opt_out" | "notice_unsupported",
  preferred: unknown,
) {
  return (kind === "notice_opt_out" ? optOut : unsupported)[
    language(preferred)
  ];
}

// Appended to the shared agent rules for this channel only. The rules
// themselves are not changed, so the tested behaviour carries over.
export const whatsappChannelNote =
  " Channel: WhatsApp chat with a real customer. Plain text only, no markdown; keep replies short. Proposals go to the business's staff for review.";
