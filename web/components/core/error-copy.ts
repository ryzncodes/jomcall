// Wording for an error code that means something different on one screen.
// The shared table in state.tsx stays the default for every other case.
export type ErrorContext = "voice";

const overrides: Record<ErrorContext, Record<string, [string, string]>> = {
  voice: {
    // The same code refuses publishing an agent; here nothing is published.
    DISCLOSURE_REQUIRED: [
      "Add an AI introduction to the agent before starting a voice test.",
      "Tambah pengenalan AI pada ejen sebelum memulakan ujian suara.",
    ],
  },
};

// Returns [English, Bahasa Melayu], or undefined to use the shared wording.
export function contextCopy(
  code: string,
  context: ErrorContext | undefined,
): [string, string] | undefined {
  return context ? overrides[context][code] : undefined;
}
