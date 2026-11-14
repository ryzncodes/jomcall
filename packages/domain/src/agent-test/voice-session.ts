import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";
import { AppError, type TenantContext } from "../../../contracts/src/index.ts";
import {
  voiceStart,
  type VoiceStartResult,
} from "../../../contracts/src/agent-test.ts";
import { voiceConfig } from "../../../inference/src/provider.ts";
import { audit } from "../../../db/src/receipts.ts";
import { manager } from "../authorization.ts";
import { loadSession } from "./sessions.ts";

// The only list of spoken voices a business may pick. These five passed the
// owner's listening test. Anything else falls back to the first.
export const VOICE_PRESETS = [
  "Kore",
  "Sulafat",
  "Leda",
  "Achird",
  "Charon",
] as const;
export const VOICE_AGENT_NAME = "jomcall-voice";
const VOICE_SECONDS = 300;

export type VoiceRooms = {
  // Creates the room and asks the named agent to join it with this metadata.
  start(call: {
    room: string;
    agentName: string;
    metadata: string;
  }): Promise<void>;
};

function liveKitRooms(url: string, key: string, secret: string): VoiceRooms {
  const host = url.replace(/^ws/, "http");
  return {
    async start({ room, agentName, metadata }) {
      await new RoomServiceClient(host, key, secret).createRoom({
        name: room,
        emptyTimeout: 120,
        maxParticipants: 3,
      });
      await new AgentDispatchClient(host, key, secret).createDispatch(
        room,
        agentName,
        { metadata },
      );
    },
  };
}

export async function startVoiceTest(
  tx: PoolClient,
  ctx: TenantContext,
  sessionId: string,
  body: unknown,
  // Injected by the route; the LiveKit client is built when none is given.
  rooms?: VoiceRooms,
): Promise<VoiceStartResult> {
  manager(ctx);
  const v = voiceStart.parse(body);
  const { config } = voiceConfig();
  if (!config) throw new AppError("VOICE_DISABLED", 503);
  const session = await loadSession(tx, ctx, sessionId, true);
  if (
    session.creator_id !== ctx.identity.userId ||
    session.auth_session_id !== ctx.identity.sessionId
  )
    throw new AppError("TEST_SESSION_OWNER", 403);
  if (session.revision !== v.expectedSessionRevision)
    throw new AppError("CONFLICT", 409);
  const settings = (session.snapshot.settings ?? {}) as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === "string" ? x : "");
  const disclosure = text(settings.aiDisclosure).trim();
  if (!disclosure) throw new AppError("DISCLOSURE_REQUIRED", 422);
  const preference = text(settings.voicePreference);
  const voice = VOICE_PRESETS.find((p) => p === preference) ?? VOICE_PRESETS[0];
  // Hex fits the token pattern the voice endpoint accepts. Only its SHA-256
  // is stored; the plain value goes to the worker in the dispatch metadata.
  const voiceToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(voiceToken).digest("hex");
  const room = "voice-" + sessionId + "-" + randomBytes(4).toString("hex");
  const expiresAt = (
    await tx.query(
      `update app.test_session set channel='voice',voice_token_hash=$3,voice_expires_at=now()+$4*interval '1 second'
       where org_id=$1 and id=$2 returning voice_expires_at`,
      [ctx.orgId, sessionId, tokenHash, VOICE_SECONDS],
    )
  ).rows[0].voice_expires_at as Date;
  // A failure here rolls the transaction back, so the old token stays valid.
  await (
    rooms ?? liveKitRooms(config.url, config.apiKey, config.apiSecret)
  ).start({
    room,
    agentName: VOICE_AGENT_NAME,
    metadata: JSON.stringify({
      sessionId,
      voiceToken,
      voice,
      greeting: text(settings.greeting),
      disclosure,
    }),
  });
  await audit(tx, ctx, "agent_test.voice_started", "test_session", sessionId);
  const jwt = new AccessToken(config.apiKey, config.apiSecret, {
    identity: "browser-" + ctx.identity.userId,
    ttl: VOICE_SECONDS,
  });
  jwt.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    // Audio only: the browser has no reason to send data into the room.
    canPublishData: false,
  });
  return {
    url: config.url,
    token: await jwt.toJwt(),
    room,
    expiresAt: expiresAt.toISOString(),
    voice,
  };
}
