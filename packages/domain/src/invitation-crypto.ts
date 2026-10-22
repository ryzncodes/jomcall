import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
export type EncryptedToken = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function encryptInvitationToken(
  value: string,
  key: string,
  scope: string,
): EncryptedToken {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  c.setAAD(Buffer.from(scope));
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return {
    version: 1,
    iv: iv.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
}
export function decryptInvitationToken(
  value: EncryptedToken,
  key: string,
  scope: string,
) {
  if (value.version !== 1) throw Error("KEY_VERSION");
  const c = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(value.iv, "hex"),
  );
  c.setAAD(Buffer.from(scope));
  c.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([
    c.update(Buffer.from(value.data, "hex")),
    c.final(),
  ]).toString();
}
