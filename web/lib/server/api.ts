import {
  agentTestRoute,
  type AgentTestDeps,
} from "../../../packages/domain/src/agent-test/routes.ts";
import { whatsappReadiness } from "../../../packages/whatsapp/src/provider.ts";
import { whatsappRoute } from "../../../packages/domain/src/whatsapp/routes.ts";
import { bookingRoute } from "../../../packages/domain/src/booking/routes.ts";
import { phoneRoute } from "../../../packages/domain/src/phone/routes.ts";
import { commands } from "../../../packages/contracts/src/core.ts";
import { privacyRoute } from "../../../packages/domain/src/privacy.ts";
import "server-only";
import { contactsRoute } from "../../../packages/domain/src/contacts.ts";
import { agentsRoute } from "../../../packages/domain/src/agents.ts";
import { setupRoute } from "../../../packages/domain/src/setup/routes.ts";
import {
  precheckChunkPut,
  setupUploadRoute,
} from "../../../packages/domain/src/setup/uploads.ts";
import { UPLOAD_LIMITS } from "../../../packages/contracts/src/setup-upload.ts";
import { knowledgeRoute } from "../../../packages/domain/src/knowledge/routes.ts";
import { workspaceRoute } from "../../../packages/domain/src/workspace.ts";
import { membersRoute } from "../../../packages/domain/src/members.ts";
import { billingRoute } from "../../../packages/domain/src/billing.ts";
import { paymentReadiness } from "../../../packages/billing/src/provider.ts";
import { tokenHash } from "../../../packages/domain/src/invitation-crypto.ts";
import { command, audit } from "../../../packages/db/src/receipts.ts";
import { z } from "zod";
import { AppError, name, uuid } from "../../../packages/contracts/src/index.ts";
import {
  signupAllow,
  signupAllowed,
} from "../../../packages/contracts/src/hosting.ts";
import { requireApp } from "./config.ts";
import { verifyIdentity } from "./auth.ts";
import { database } from "./services.ts";
import { requireMutation } from "./csrf.ts";
import { respond, failure, readBody, readRaw } from "./http.ts";
// Outside collaborators a caller may replace. The app passes none and gets the
// real ones; tests pass fakes through createDispatch.
export type CoreDeps = { agentTest?: AgentTestDeps };
// Next.js route handlers receive a second argument, so the exported handler
// takes the request only and never reads dependencies from its caller.
export function dispatchCore(request: Request) {
  return dispatch(request, {});
}
export function createDispatch(deps: CoreDeps) {
  return (request: Request) => dispatch(request, deps);
}
async function dispatch(request: Request, deps: CoreDeps) {
  try {
    requireApp();
    const method = request.method,
      path = new URL(request.url).pathname.slice("/api/v1".length);
    const mutation = !["GET", "HEAD"].includes(method);
    if (mutation) requireMutation(request);
    const identity = await verifyIdentity(request);
    const db = database();
    const disabled =
      /^\/(inbox|whatsapp|integrations|payments|outbound|admin|self-host|test-call)(?:\/|$)/.test(
        path,
      );
    const matching = Object.values(commands).filter((c) =>
      new RegExp("^" + c.path.replace(/:[a-zA-Z]+/g, "[^/]+") + "$").test(path),
    );
    const download = /^\/jobs\/[^/]+\/download$/.test(path);
    if (!disabled && !matching.length && !download)
      throw new AppError("NOT_FOUND", 404);
    if (
      !disabled &&
      !(download && method === "GET") &&
      !matching.some((c) => c.method === method)
    )
      throw new AppError("METHOD_NOT_ALLOWED", 405);
    if (path === "/session" && method === "GET")
      return respond({
        userId: identity.userId,
        email: identity.confirmedEmail,
        memberships: await db.organizations(identity),
      });
    if (path === "/organizations" && method === "GET")
      return respond(await db.organizations(identity));
    const key = mutation
      ? uuid.parse(request.headers.get("idempotency-key"))
      : "";
    // A setup upload chunk is raw bytes (at most 3 MiB); every other
    // mutation is JSON.
    const chunkPut =
      method === "PUT" &&
      /^\/agents\/[^/]+\/setup\/uploads\/[^/]+\/chunks\/[^/]+$/.test(path);
    const body = !mutation
      ? {}
      : chunkPut
        ? await (async () => {
            // Refuse staff, strangers and late chunks before reading up to
            // 3 MiB; the command checks again under its locks.
            await db.withUserTransaction(
              identity,
              uuid.parse(request.headers.get("x-organization-id")),
              (tx, context) => precheckChunkPut(tx, context, path),
            );
            return readRaw(request, UPLOAD_LIMITS.chunkBytes);
          })()
        : await readBody(request);
    if (path === "/organizations" && method === "POST") {
      // Second layer behind the sign-up gate: an account made some other way
      // (for example straight against the auth service) still cannot open a
      // workspace, and so cannot top up, unless its address is on the list.
      const allow = signupAllow();
      if (allow && !signupAllowed(allow, identity.confirmedEmail))
        throw new AppError("WORKSPACE_NOT_ALLOWED", 403);
      return respond(
        await db.bootstrap(identity, body, { idempotencyKey: key }),
        201,
      );
    }
    if (path === "/invitations/accept" && method === "POST") {
      const value = z
        .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(body);
      const member = await db.withIdentity(
        identity,
        async (tx) =>
          (
            await tx.query(
              "select app_private.accept_invitation($1,$2) as member",
              [tokenHash(value.token), identity.confirmedEmail],
            )
          ).rows[0].member,
      );
      return respond(member);
    }
    const orgId = uuid.parse(request.headers.get("x-organization-id"));
    return await db.withUserTransaction(
      identity,
      orgId,
      async (tx, context) => {
        if (disabled) throw new AppError("CAPABILITY_UNAVAILABLE", 503);
        const whatsappResult = await whatsappRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
        );
        if (whatsappResult !== undefined) return respond(whatsappResult);
        const testResult = await agentTestRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
          deps.agentTest,
        );
        if (testResult !== undefined)
          return respond(
            testResult,
            method === "POST" && /\/turns$/.test(path) ? 202 : 200,
          );
        const bookingResult = await bookingRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
        );
        if (bookingResult !== undefined) return respond(bookingResult);
        const phoneResult = await phoneRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
        );
        if (phoneResult !== undefined) return respond(phoneResult);
        const billingResult = await billingRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
        );
        if (billingResult !== undefined) return respond(billingResult);
        const memberResult = await membersRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
        );
        if (memberResult !== undefined) return respond(memberResult);
        const knowledgeResult = await knowledgeRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
        );
        if (knowledgeResult !== undefined) return respond(knowledgeResult);
        const uploadResult = await setupUploadRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
        );
        // A returned AppError is a refusal whose writes are kept (a refused
        // upload's bytes are deleted), so the transaction commits.
        if (uploadResult instanceof AppError) return failure(uploadResult);
        if (uploadResult instanceof Response) return uploadResult;
        if (uploadResult !== undefined) return respond(uploadResult);
        const setupResult = await setupRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
        );
        if (setupResult !== undefined) return respond(setupResult);
        const agentResult = await agentsRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
        );
        if (agentResult !== undefined) return respond(agentResult);
        const workspaceResult = await workspaceRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
        );
        if (workspaceResult !== undefined) return respond(workspaceResult);
        const privacyResult = await privacyRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
        );
        if (privacyResult !== undefined)
          return privacyResult instanceof Response
            ? privacyResult
            : respond(privacyResult);
        const contactResult = await contactsRoute(
          tx,
          context,
          method,
          path,
          body,
          key,
          new URL(request.url).searchParams,
        );
        if (contactResult !== undefined) return respond(contactResult);
        const bootstrap = path.match(/^\/organizations\/([^/]+)\/bootstrap$/);
        if (bootstrap && method === "GET") {
          if (bootstrap[1] !== orgId) throw new AppError("NOT_FOUND", 404);
          const org = (
            await tx.query("select * from app.organization where id=$1", [
              orgId,
            ])
          ).rows[0];
          const locations = (
            await tx.query(
              "select * from app.location where org_id=$1 and archived_at is null order by created_at,id",
              [orgId],
            )
          ).rows;
          const summary = (
            await tx.query("select app_private.agent_summary($1) as summary", [
              orgId,
            ])
          ).rows[0].summary;
          return respond({
            workspace: org,
            role: context.role,
            locations,
            agent: summary,
            contactCount: Number(
              (
                await tx.query(
                  "select count(*) from app.contact where org_id=$1",
                  [orgId],
                )
              ).rows[0].count,
            ),
            capabilities: {
              core: true,
              voice: false,
              whatsapp: whatsappReadiness().configured,
              calendar: false,
              payments: paymentReadiness().configured,
            },
          });
        }
        const update = path.match(/^\/organizations\/([^/]+)$/);
        if (update && method === "PATCH") {
          if (update[1] !== orgId) throw new AppError("NOT_FOUND", 404);
          if (context.role === "staff") throw new AppError("FORBIDDEN", 403);
          const value = z
            .object({
              name,
              businessType: z.string().min(1).max(80),
              expectedRevision: z.number().int().positive(),
            })
            .strict()
            .parse(body);
          const data = await command(
            tx,
            context,
            key,
            "updateOrganization",
            value,
            async () => {
              const result = await tx.query(
                "update app.organization set name=$1,business_type=$2,revision=revision+1,updated_at=now() where id=$3 and revision=$4 returning *",
                [value.name, value.businessType, orgId, value.expectedRevision],
              );
              if (!result.rowCount) throw new AppError("CONFLICT", 409);
              await audit(
                tx,
                context,
                "organization.updated",
                "organization",
                orgId,
              );
              return { ref: { id: orgId }, data: result.rows[0] };
            },
            async () =>
              (
                await tx.query("select * from app.organization where id=$1", [
                  orgId,
                ])
              ).rows[0],
          );
          return respond(data);
        }
        throw new AppError("NOT_FOUND", 404);
      },
    );
  } catch (e) {
    return failure(e);
  }
}
