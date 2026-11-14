// Per-organization WhatsApp credentials at rest: AES-256-GCM, bound to the
// organization so a stored envelope cannot be moved to another tenant. The
// web process seals on save; only the agent process opens. The database
// column is not readable by the web role at all.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SealedCredentials = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};
export type ChannelCredentials = { accessToken: string };

function key(hex: string | undefined) {
  if (!/^[a-f0-9]{64}$/.test(hex ?? ""))
    throw Error("WHATSAPP_CREDENTIALS_KEY_REQUIRED");
  return Buffer.from(hex!, "hex");
}

export function sealCredentials(
  value: ChannelCredentials,
  keyHex: string | undefined,
  orgId: string,
): SealedCredentials {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(keyHex), iv);
  cipher.setAAD(Buffer.from("whatsapp:" + orgId));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
}

export function openCredentials(
  sealed: SealedCredentials,
  keyHex: string | undefined,
  orgId: string,
): ChannelCredentials {
  if (sealed?.version !== 1) throw Error("WHATSAPP_CREDENTIALS_INVALID");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(keyHex),
      Buffer.from(sealed.iv, "hex"),
    );
    decipher.setAAD(Buffer.from("whatsapp:" + orgId));
    decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
    const value = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(sealed.data, "hex")),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (typeof value?.accessToken !== "string" || !value.accessToken)
      throw Error();
    return { accessToken: value.accessToken };
  } catch (e) {
    if (e instanceof Error && e.message === "WHATSAPP_CREDENTIALS_KEY_REQUIRED")
      throw e;
    throw Error("WHATSAPP_CREDENTIALS_INVALID");
  }
}
