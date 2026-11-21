// The call card's language cycle: one pass through every language, then it
// rests on the first and stops for good (WCAG 2.2.2, pause, stop, hide).
export function nextInCycle(voice: number, total: number): { voice: number; auto: boolean } {
  const next = voice + 1;
  return next >= total ? { voice: 0, auto: false } : { voice: next, auto: true };
}
