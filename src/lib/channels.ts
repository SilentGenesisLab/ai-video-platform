import { z } from "zod";
import { Actor, requireHuman, requireScope } from "./auth";
import { assert } from "./errors";
import { db } from "./db";
import { encrypt } from "./security";
import { audit, json, Tx } from "./services";
const schema = z.object({
  name: z.string().min(1).max(100),
  provider: z.enum(["aicentre", "deepseek"]),
  baseUrl: z
    .url()
    .refine((v) => new URL(v).protocol === "https:", "渠道须为 HTTPS"),
  apiKey: z.string().optional(),
  enabled: z.boolean().default(true),
  concurrency: z.number().int().min(1).max(20).default(3),
  models: z.record(z.string(), z.array(z.string())).default({}),
});
export async function listChannels(actor: Actor) {
  requireScope(actor, "read");
  const rows = await db.channel.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(({ ciphertext, ...c }) => ({
    ...c,
    configured: !!ciphertext,
  }));
}
export async function saveChannel(
  actor: Actor,
  input: unknown,
  tx: Tx,
  id?: string,
) {
  requireHuman(actor);
  requireScope(actor, "admin");
  const { apiKey, ...data } = schema.parse(input);
  const old = id ? await tx.channel.findUnique({ where: { id } }) : null;
  if (id) assert(old, 404, "渠道不存在");
  assert(old || apiKey, 422, "需要 API Key");
  const c = old
    ? await tx.channel.update({
        where: { id },
        data: {
          ...data,
          models: json(data.models),
          ...(apiKey ? { ciphertext: encrypt(apiKey) } : {}),
        },
      })
    : await tx.channel.create({
        data: {
          ...data,
          models: json(data.models),
          ciphertext: encrypt(apiKey!),
        },
      });
  await audit(tx, actor, old ? "channel.updated" : "channel.created", c.id);
  const { ciphertext, ...safe } = c;
  return { ...safe, configured: !!ciphertext };
}
