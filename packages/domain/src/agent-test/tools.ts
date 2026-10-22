import { AppError } from "../../../contracts/src/index.ts";
import {
  toolCallSchema,
  type ToolCall,
  type Proposal,
  type KnowledgeHit,
} from "../../../contracts/src/agent-test.ts";
import type { Resource, Slot } from "../../../contracts/src/booking.ts";
import {
  buildKnowledgeIndex,
  searchKnowledge,
  type Snapshot,
} from "./knowledge.ts";
type ReadResult =
  | { kind: "knowledge"; items: KnowledgeHit[] }
  | { kind: "availability"; items: Slot[] };
export type ToolResult = ReadResult | { kind: "proposal"; proposal: Proposal };
export type ToolEffect =
  | ReadResult
  | {
      kind: "proposal";
      proposal:
        | {
            kind: "booking";
            details: { resourceId: string; startAt: string; title: string };
          }
        | { kind: "message"; details: { text: string } }
        | { kind: "handoff"; details: { reason: string } };
    };
// Only a repository bound to a stored, authorized turn may implement this port.
// read/availability/record independently verify the current lease and authority.
export interface ToolAccess {
  read(): Promise<{
    snapshot: Snapshot;
    locationId: string;
    resources: Resource[];
  }>;
  availability(args: {
    resourceId: string;
    fromDate: string;
    days: number;
  }): Promise<Slot[]>;
  record(step: number, call: ToolCall, effect: ToolEffect): Promise<ToolResult>;
}
export async function executeTestTool(
  access: ToolAccess,
  step: number,
  input: unknown,
): Promise<ToolResult> {
  if (!Number.isInteger(step) || step < 0 || step >= 4)
    throw new AppError("TOOL_LIMIT", 422);
  const call = toolCallSchema.parse(input),
    context = await access.read();
  const resourceId = "resourceId" in call.args ? call.args.resourceId : null;
  if (
    resourceId &&
    !context.resources.some(
      (r) =>
        r.id === resourceId && r.location_id === context.locationId && r.active,
    )
  )
    throw new AppError("NOT_FOUND", 404);
  let effect: ToolEffect;
  switch (call.name) {
    case "search_knowledge":
      effect = {
        kind: "knowledge",
        items: searchKnowledge(
          buildKnowledgeIndex(context.snapshot),
          call.args.query,
        ),
      };
      break;
    case "check_availability":
      effect = {
        kind: "availability",
        items: await access.availability(call.args),
      };
      break;
    case "book_slot":
      effect = {
        kind: "proposal",
        proposal: { kind: "booking", details: call.args },
      };
      break;
    case "take_message":
      effect = {
        kind: "proposal",
        proposal: { kind: "message", details: call.args },
      };
      break;
    case "handoff_to_human":
      effect = {
        kind: "proposal",
        proposal: { kind: "handoff", details: call.args },
      };
      break;
  }
  return access.record(step, call, effect);
}
