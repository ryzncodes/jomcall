// Helpers for a write that goes through the agent page's save queue. No
// React or DOM here, so they run under node:test.
import type { Job } from "./save-queue.ts";

// Sends one write through the queue; resolves with its result, rejects when
// the write (or an earlier job whose conflict dropped it) failed.
export async function queuedWrite<T extends { revision: number }>(
  queue: { push: (job: Job) => Promise<void> },
  write: (revision: number, key: string) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await queue.push({
    run: async (revision, key) => {
      result = await write(revision, key);
      return result.revision;
    },
  });
  return result as T;
}

// True only when the write was stored, so a form clears its text only then.
// `after` (reading the list again) runs only on success.
export async function stored<T>(
  result: T | undefined,
  after: () => Promise<unknown>,
): Promise<boolean> {
  if (!result) return false;
  await after();
  return true;
}
