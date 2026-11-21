// The facts behind the getting-started list, in one read for Home, the
// sidebar and setup's live page. Owners and admins only.
export type FirstRun = {
  setupApplied: boolean;
  tested: boolean;
  published: boolean;
  plan: { chosen: boolean; unpaid: boolean };
  phone: {
    offered: boolean;
    active: boolean;
    activeE164: string | null;
    requestOpen: boolean;
    planIncludesNumber: boolean;
  };
  // The earliest real call the agent answered; browser tests are not calls.
  firstCall: { id: string; startedAt: string } | null;
};
