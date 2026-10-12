import 'dotenv/config';
import { db } from "../src/lib/db";
import { encrypt } from "../src/lib/security";
import bcrypt from "bcryptjs";
async function main() {
  const email = process.env.ADMIN_EMAIL,
    password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters)");
  const admin = await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: {
      email: email.toLowerCase(),
      name: process.env.ADMIN_NAME ?? "管理员",
      role: "admin",
      platformAdmin: true,
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  await db.team.upsert({where:{id:"legacy-team"},create:{id:"legacy-team",name:"原团队",createdBy:admin.id},update:{}});
  await db.teamMember.upsert({where:{teamId_userId:{teamId:"legacy-team",userId:admin.id}},create:{teamId:"legacy-team",userId:admin.id,role:"owner"},update:{}});
  const presets = [
    {
      name: "DeepSeek · 创作与识图",
      provider: "deepseek",
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      key: process.env.DEEPSEEK_API_KEY,
      models: {
        text: [process.env.DEEPSEEK_MODEL ?? "deepseek-flash"],
        vision: [process.env.DEEPSEEK_MODEL ?? "deepseek-flash"],
      },
    },
    {
      name: "AI Centre · 媒体生成",
      provider: "aicentre",
      baseUrl:
        process.env.AICENTRE_BASE_URL ?? "https://aicentre2.sligenai.cn:8443",
      key: process.env.AICENTRE_API_KEY,
      models: {
        image: [
          "gpt-image-2.5",
          "gpt-image-2",
          "nano-banana-2",
          "nanobanana-2.1",
        ],
        video: ["seedance-2.5", "seedance-2.0"],
        audio: ["suno-v6", "suno-sound"],
      },
    },
  ];
  for (const p of presets) {
    if (
      p.key &&
      !(await db.channel.findFirst({ where: { provider: p.provider } }))
    )
      await db.channel.create({
        data: {
          name: p.name,
          provider: p.provider,
          baseUrl: p.baseUrl,
          ciphertext: encrypt(p.key),
          models: JSON.parse(JSON.stringify(p.models)),
          concurrency: 3,
        },
      });
  }
  console.log(
    "Admin and configured channels initialized. No existing credentials were overwritten.",
  );
}
main().finally(() => db.$disconnect());
