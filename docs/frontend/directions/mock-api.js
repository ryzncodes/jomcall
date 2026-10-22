/** Phase 1 fixture only. Schema-shaped entities; masked display numbers cannot dial. */
/** @typedef {{id:string, org_id:string, contact_id:string, agent_version_id:string, started_at:string, duration_seconds:number, cost_sen:number, outcome:number, language:string}} Call */
export const mockApi = {
  async getCalls() {
    return [
      {
        id: "sample-call-a",
        org_id: "sample-org",
        contact_id: "sample-contact-a",
        agent_version_id: "sample-version",
        started_at: "2026-10-15T02:42:00Z",
        duration_seconds: 154,
        cost_sen: 82,
        outcome: 0,
        language: "BM",
      },
      {
        id: "sample-call-b",
        org_id: "sample-org",
        contact_id: "sample-contact-b",
        agent_version_id: "sample-version",
        started_at: "2026-10-15T02:18:00Z",
        duration_seconds: 108,
        cost_sen: 58,
        outcome: 1,
        language: "EN",
      },
      {
        id: "sample-call-c",
        org_id: "sample-org",
        contact_id: "sample-contact-c",
        agent_version_id: "sample-version",
        started_at: "2026-10-15T01:56:00Z",
        duration_seconds: 72,
        cost_sen: 39,
        outcome: 2,
        language: "中文",
      },
    ];
  },
  async getContacts() {
    return ["A", "B", "C"].map((letter) => ({
      id: `sample-contact-${letter.toLowerCase()}`,
      org_id: "sample-org",
      name: `Pelanggan Contoh ${letter}`,
      phone_e164: null,
      do_not_contact: false,
    }));
  },
};
