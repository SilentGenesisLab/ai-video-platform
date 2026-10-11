import { db } from "../src/lib/db";
import { decrypt } from "../src/lib/security";
import { oss } from "../src/lib/storage";
async function main() {
  for (const provider of ["deepseek", "aicentre"]) {
    const c = await db.channel.findFirstOrThrow({ where: { provider } });
    try {
      const url =
        c.baseUrl +
        (provider === "deepseek"
          ? "/models"
          : "/v1/video-generations/jobs/00000000-0000-0000-0000-000000000000");
      const r = await fetch(url, {
        headers: { Authorization: "Bearer " + decrypt(c.ciphertext) },
        signal: AbortSignal.timeout(20000),
      });
      const data = await r.json();
      console.log(
        JSON.stringify({
          provider,
          status: r.status,
          ...(provider === "deepseek"
            ? { models: data.data?.map((m: any) => m.id) }
            : { authenticated: r.status === 404 }),
        }),
      );
    } catch (e) {
      console.log(
        JSON.stringify({
          provider,
          error: e instanceof Error ? e.name : "failed",
        }),
      );
    }
  }
  try {
    await oss().getBucketInfo(process.env.OSS_BUCKET!);
    console.log("OSS bucket readable");
  } catch (e) {
    console.log("OSS preflight: " + (e as Error).name);
  }
}
main().finally(() => db.$disconnect());
