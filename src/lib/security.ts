import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function randomToken(prefix = "avp_") {
  return prefix + randomBytes(32).toString("base64url");
}
function encryptionKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET ?? "";
  if (!/^[a-f\d]{64}$/i.test(secret))
    throw new Error("KEY_ENCRYPTION_SECRET must be 32 random bytes in hex");
  return Buffer.from(secret, "hex");
}
export function encrypt(text: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decrypt(text: string) {
  const bytes = Buffer.from(text, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    bytes.subarray(0, 12),
  );
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function equalSecret(a: string, b: string) {
  return (
    !!a &&
    !!b &&
    timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)))
  );
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export function redact(value: unknown): unknown {
  if (typeof value === "string")
    return value
      .replace(/\b(?:sk-|aic_|avp_|avr_)[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
      .replace(
        /([?&](?:Signature|x-oss-signature|OSSAccessKeyId)=)[^&\s]+/gi,
        "$1[REDACTED]",
      );
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /password|ciphertext|authorization|secret|api.?key|token/i.test(k)
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  return value;
}
