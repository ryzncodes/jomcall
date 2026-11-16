// The operator email sent when document reading in guided setup reaches the
// service-wide daily ceiling (app.setup_read_limit). The database answers
// app_private.setup_read_ceiling_notice() at most once per Kuala Lumpur day,
// and marks the day before this is sent, so a failed send is not retried
// that day. English only (operator-facing); counts only, no organization or
// file details.
export type ReadCeilingNotice = {
  day: string;
  started: number;
  ceiling: number;
  waiting: number;
};

export function readCeilingMail(n: ReadCeilingNotice) {
  return {
    subject: "JomCall: document reading paused at the daily ceiling",
    text:
      `Document reading reached today's ceiling: ${n.started} files started in the last 24 hours (ceiling ${n.ceiling}). ` +
      `${n.waiting} files are waiting and will be read as earlier ones age out of the 24-hour window. ` +
      "To raise the ceiling: update app.setup_read_limit set daily_reads = <n>. No file has failed.",
  };
}

// The operator email sent when stored setup uploads (declared sizes of files
// whose bytes are still held) reach 80 percent of the service-wide ceiling
// (app.setup_read_limit.stored_bytes_max). The database answers
// app_private.setup_bytes_notice() at most once per Kuala Lumpur day, and
// marks the day before this is sent. English only; counts only. MB are whole
// numbers rounded down (1 MB = 1,048,576 bytes), so the stored figure is
// never overstated.
export type BytesCeilingNotice = {
  day: string;
  storedBytes: number;
  maxBytes: number;
};

const MB = 1_048_576;
export function bytesCeilingMail(n: BytesCeilingNotice) {
  return {
    subject: "JomCall: stored setup uploads are near the ceiling",
    text:
      `Stored setup uploads hold ${Math.floor(n.storedBytes / MB)} MB of ${Math.floor(n.maxBytes / MB)} MB. ` +
      "New files are refused when the ceiling is reached. File bytes are deleted 7 days after upload. " +
      "To raise the ceiling: update app.setup_read_limit set stored_bytes_max = <bytes>.",
  };
}
