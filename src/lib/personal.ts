import type { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { db, systemDb } from "./db";
import { Actor, requireHuman, sameOrigin } from "./auth";
import { assert } from "./errors";
import { objectKey, oss, readUrl, validateMagic } from "./storage";

export async function personalRoute(
  req: NextRequest,
  a: Actor,
  parts: string[],
  body: any,
) {
  const [group, id, action] = parts;
  if (!(
    (group === "auth" &&
      ["profile", "avatar", "change-password"].includes(id)) ||
    group === "feedback"
  ))
    return undefined;
  requireHuman(a);
  if (req.method !== "GET") sameOrigin(req);
  if (group === "auth") {
    const user = await systemDb.user.findUniqueOrThrow({
      where: { id: a.userId },
    });
    if (id === "profile" && req.method === "GET")
      return {
        name: user.name,
        email: user.email,
        phone: user.phone
          ? user.phone.replace(/(\d{3})\d{4}(\d{4})$/, "$1****$2")
          : null,
        avatarUrl: user.avatarKey ? readUrl(user.avatarKey) : null,
      };
    if (id === "profile" && req.method === "PATCH") {
      const { name } = z
        .object({ name: z.string().trim().min(1).max(60) })
        .parse(body);
      await systemDb.user.update({ where: { id: a.userId }, data: { name } });
      await db.auditEvent.create({
        data: {
          teamId: a.teamId,
          actorId: a.userId,
          actorType: "human",
          action: "account.profile",
          entityId: a.userId,
          data: {},
        },
      });
      return { ok: true, name };
    }
    if (id === "avatar" && req.method === "POST") {
      const form = await req.formData(),
        file = form.get("file");
      assert(
        file instanceof File && file.size > 0 && file.size <= 512 * 1024,
        422,
        "头像须小于 512KB",
      );
      assert(
        ["image/png", "image/jpeg", "image/webp"].includes(file.type),
        422,
        "头像支持 PNG、JPEG 或 WebP",
      );
      const bytes = Buffer.from(await file.arrayBuffer());
      validateMagic(bytes, file.type);
      let image: Buffer;
      try {
        image = await sharp(bytes, { limitInputPixels: 16000000 })
          .rotate()
          .resize(256, 256, { fit: "cover" })
          .png()
          .toBuffer();
      } catch {
        assert(false, 422, "无法读取头像图片");
      }
      const key = objectKey("avatar.png");
      await oss().put(key, image!, { mime: "image/png" });
      await systemDb.user.update({
        where: { id: a.userId },
        data: { avatarKey: key },
      });
      return { ok: true, avatarUrl: readUrl(key) };
    }
    if (id === "change-password" && req.method === "POST") {
      assert(
        (await systemDb.auditEvent.count({
          where: {
            actorId: a.userId,
            action: "account.password.failed",
            createdAt: { gte: new Date(Date.now() - 900000) },
          },
        })) < 5,
        429,
        "密码验证次数过多，请稍后再试",
      );
      const data = z
        .object({
          currentPassword: z.string().max(200),
          password: z.string().min(12, "密码至少 12 位").max(72),
        })
        .parse(body);
      if (!(await bcrypt.compare(data.currentPassword, user.passwordHash))) {
        await db.auditEvent.create({
          data: {
            teamId: a.teamId,
            actorId: a.userId,
            actorType: "human",
            action: "account.password.failed",
            entityId: a.userId,
            data: {},
          },
        });
        assert(false, 422, "当前密码不正确");
      }
      const passwordHash = await bcrypt.hash(data.password, 12);
      await systemDb.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: { id: a.userId, passwordHash: user.passwordHash },
          data: { passwordHash },
        });
        assert(changed.count === 1, 409, "密码已发生变化，请重试");
        await tx.session.deleteMany({
          where: { userId: a.userId, id: { not: a.sessionId } },
        });
        await tx.auditEvent.create({
          data: {
            teamId: a.teamId,
            actorId: a.userId,
            actorType: "human",
            action: "account.password",
            entityId: a.userId,
            data: {},
          },
        });
      });
      return { ok: true };
    }
    return undefined;
  }
  if (req.method === "GET") {
    if (!id) {
      const rows = await db.feedback.findMany({
        where: a.platformAdmin ? {} : { userId: a.userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return rows.map((r) => ({
        ...r,
        attachments: (r.attachments as any[]).map((f) => ({
          name: f.name,
          size: f.size,
        })),
      }));
    }
    if (action === "attachments") {
      const row = await db.feedback.findUnique({ where: { id } });
      assert(
        row && (row.userId === a.userId || a.platformAdmin),
        404,
        "反馈不存在",
      );
      return (row.attachments as any[]).map((f) => ({
        name: f.name,
        url: oss().signatureUrl(f.key, {
          expires: 600,
          response: { "content-disposition": "attachment" },
        }),
      }));
    }
    return undefined;
  }
  if (!id && req.method === "POST") {
    assert(
      (await db.feedback.count({
        where: {
          userId: a.userId,
          createdAt: { gte: new Date(Date.now() - 3600000) },
        },
      })) < 5,
      429,
      "反馈提交过于频繁，请稍后再试",
    );
    const form = await req.formData();
    const data = z
      .object({
        type: z.enum(["产品建议", "问题反馈", "使用咨询", "其他"]),
        content: z.string().trim().min(5, "请至少填写 5 个字").max(2000),
      })
      .parse({ type: form.get("type"), content: form.get("content") });
    const files = form.getAll("files");
    assert(files.length <= 3, 422, "最多上传 3 个附件");
    const prepared = [];
    for (const file of files) {
      assert(
        file instanceof File && file.size > 0 && file.size <= 5 * 1024 * 1024,
        422,
        "每个附件须小于 5MB",
      );
      assert(
        [
          "image/png",
          "image/jpeg",
          "image/webp",
          "application/pdf",
          "text/plain",
        ].includes(file.type),
        422,
        "附件支持 PNG、JPEG、WebP、PDF 和 TXT",
      );
      const bytes = Buffer.from(await file.arrayBuffer());
      validateMagic(bytes, file.type);
      prepared.push({ file, bytes, key: objectKey(file.name) });
    }
    const attachments: {
      key: string;
      name: string;
      size: number;
      mime: string;
    }[] = [];
    for (const { file, bytes, key } of prepared) {
      await oss().put(key, bytes, {
        mime: file.type,
        headers: { "Content-Disposition": "attachment" },
      });
      attachments.push({
        key,
        name: file.name.slice(0, 200),
        size: file.size,
        mime: file.type,
      });
    }
    const row = await db.$transaction(async (tx) => {
      const r = await tx.feedback.create({
        data: { ...data, userId: a.userId, teamId: a.teamId, attachments },
      });
      await tx.auditEvent.create({
        data: {
          teamId: a.teamId,
          actorId: a.userId,
          actorType: "human",
          action: "feedback.submitted",
          entityId: r.id,
          data: { type: r.type, attachmentCount: attachments.length },
        },
      });
      return r;
    });
    return { id: row.id, createdAt: row.createdAt };
  }
  return undefined;
}
