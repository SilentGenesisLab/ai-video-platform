import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { db } from "./db";
import { assert, HttpError } from "./errors";
import { z } from "zod";
const purposeSchema = z.enum(["register", "login", "reset", "bind"]);
export function phoneNumber(v: unknown) {
  const n = z
    .string()
    .parse(v)
    .replace(/[\s-]/g, "")
    .replace(/^\+?86/, "");
  assert(/^1[3-9]\d{9}$/.test(n), 422, "请输入有效的中国大陆手机号");
  return "+86" + n;
}
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
export async function smsRpc(action: string, params: Record<string, string>) {
  const ak = process.env.SMS_ACCESS_KEY_ID,
    sk = process.env.SMS_ACCESS_KEY_SECRET;
  assert(
    ak && sk && process.env.SMS_SIGN_NAME && process.env.SMS_TEMPLATE_CODE,
    503,
    "短信服务暂未配置，请使用邮箱登录",
    "SMS_UNAVAILABLE",
  );
  const p: Record<string, string> = {
    Action: action,
    Version: "2017-05-25",
    Format: "JSON",
    AccessKeyId: ak,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    RegionId: process.env.SMS_REGION ?? "cn-hangzhou",
    ...params,
  };
  const query = Object.keys(p)
    .sort()
    .map((k) => enc(k) + "=" + enc(p[k]))
    .join("&");
  p.Signature = createHmac("sha1", sk + "&")
    .update("POST&%2F&" + enc(query))
    .digest("base64");
  const r = await fetch("https://dysmsapi.aliyuncs.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(p),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  assert(
    r.ok && data.Code === "OK",
    503,
    "短信服务暂不可用，请稍后重试",
    "SMS_PROVIDER_ERROR",
  );
  return data;
}
function hash(code: string, id: string) {
  const key = process.env.INTERNAL_SERVICE_SECRET;
  assert(key, 503, "服务鉴权配置缺失");
  return createHmac("sha256", key)
    .update(id + ":" + code)
    .digest("hex");
}
export async function sendSms(input: any, ip: string, userId?: string) {
  const phone = phoneNumber(input.phone),
    purpose = purposeSchema.parse(input.purpose);
  assert(purpose !== "bind" || userId, 401, "请先登录再绑定手机号");
  assert(
    process.env.SMS_ACCESS_KEY_ID && process.env.SMS_TEMPLATE_CODE,
    503,
    "短信服务暂未配置",
    "SMS_UNAVAILABLE",
  );
  const code = String(randomInt(100000, 1000000)),
    id = randomUUID(),
    ipHash = hash(ip, "sms-ip");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ipHash}))`;
    const now = Date.now();
    const [recent, hour, day, ipHour, ipDay] = await Promise.all([
      tx.smsChallenge.count({
        where: { phone, createdAt: { gte: new Date(now - 60000) } },
      }),
      tx.smsChallenge.count({
        where: { phone, createdAt: { gte: new Date(now - 3600000) } },
      }),
      tx.smsChallenge.count({
        where: { phone, createdAt: { gte: new Date(now - 86400000) } },
      }),
      tx.smsChallenge.count({
        where: { ipHash, createdAt: { gte: new Date(now - 3600000) } },
      }),
      tx.smsChallenge.count({
        where: { ipHash, createdAt: { gte: new Date(now - 86400000) } },
      }),
    ]);
    assert(
      !recent && hour < 5 && day < 10 && ipHour < 20 && ipDay < 100,
      429,
      "验证码请求过于频繁，请稍后重试",
      "SMS_RATE_LIMIT",
    );
    await tx.smsChallenge.create({
      data: {
        id,
        phone,
        purpose,
        hash: hash(code, id),
        ipHash,
        userId,
        expiresAt: new Date(now + 300000),
      },
    });
  });
  try {
    await smsRpc("SendSms", {
      PhoneNumbers: phone.slice(3),
      SignName: process.env.SMS_SIGN_NAME!,
      TemplateCode: process.env.SMS_TEMPLATE_CODE!,
      TemplateParam: JSON.stringify({
        [process.env.SMS_CODE_VARIABLE ?? "code"]: code,
      }),
    });
    await db.smsChallenge.update({ where: { id }, data: { status: "sent" } });
  } catch (e) {
    await db.smsChallenge.update({ where: { id }, data: { status: "failed" } });
    throw e;
  }
  return { challengeId: id, retryAfter: 60, expiresIn: 300 };
}
export async function consumeSms(
  phone: string,
  purpose: string,
  code: unknown,
  userId?: string,
) {
  const value = z
    .string()
    .regex(/^\d{6}$/, "请输入六位验证码")
    .parse(code);
  const valid = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;
    const row = await tx.smsChallenge.findFirst({
      where: {
        phone,
        purpose,
        status: "sent",
        ...(purpose === "bind" ? { userId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (
      !row ||
      row.consumedAt ||
      row.expiresAt < new Date() ||
      row.attempts >= 5
    )
      return false;
    const a = Buffer.from(row.hash),
      b = Buffer.from(hash(value, row.id));
    const match = a.length === b.length && timingSafeEqual(a, b);
    await tx.smsChallenge.update({
      where: { id: row.id },
      data: match ? { consumedAt: new Date() } : { attempts: { increment: 1 } },
    });
    return match;
  });
  assert(valid, 401, "验证码无效或已过期，请重新获取", "INVALID_OTP");
}
