import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { zipSync } from "fflate";
const root = join(process.cwd(), "public", "skills", "ai-video-platform");
const files: Record<string, Uint8Array> = {};
async function walk(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const data = await readFile(path);
      if (/\b(?:sk-|aic_|avp_)[A-Za-z0-9_-]{16,}/.test(data.toString()))
        throw new Error("Credential-like value found in public skill");
      files["ai-video-platform/" + relative(root, path).replaceAll("\\", "/")] =
        data;
    }
  }
}
async function main() {
  await walk(root);
  await writeFile(join(root, "..", "ai-video-platform.zip"), zipSync(files));
  console.log(
    "Skill package built: " +
      Object.keys(files).length +
      " files, version 1.4.2",
  );
}
void main();
