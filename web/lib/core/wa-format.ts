// WhatsApp shows *text* as bold. The agent's replies use it for item names,
// so the inbox shows the same bold instead of raw asterisks. Only bold is
// handled: it is the one mark the agent is told to use. The text is split
// into plain and bold pieces; nothing is ever turned into HTML.
export type WaPiece = { text: string; bold: boolean };

// WhatsApp's own rule, near enough: the stars hug the words (no space just
// inside them), the bold part stays on one line, and the opening star does
// not follow a letter or digit (so 2*3*4 and file*name* stay as typed).
const BOLD =
  /(^|[^\p{L}\p{N}*])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?![\p{L}\p{N}*])/gu;

export function waPieces(text: string): WaPiece[] {
  const out: WaPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    const start = m.index! + m[1].length;
    if (start > last) out.push({ text: text.slice(last, start), bold: false });
    out.push({ text: m[2], bold: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}
