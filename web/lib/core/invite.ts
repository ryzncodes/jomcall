// An invitation link carries a token. A person who must sign in or create an
// account first would lose it, so the invitation page keeps it in this
// browser until the invitation is accepted. Storage can be unavailable
// (private windows); every call then does nothing.
const KEY = "jomcall.invite";
const TOKEN = /^[a-f0-9]{64}$/;

export const validInvite = (
  token: string | null | undefined,
): token is string => !!token && TOKEN.test(token);

export function rememberInvite(token: string) {
  if (!validInvite(token)) return;
  try {
    localStorage.setItem(KEY, token);
  } catch {}
}

export function pendingInvite(): string | null {
  try {
    const token = localStorage.getItem(KEY);
    return validInvite(token) ? token : null;
  } catch {
    return null;
  }
}

export function forgetInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
