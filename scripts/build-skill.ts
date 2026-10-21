import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

/** 打包 skill 目录为同名 zip：`<root>/<name>/` → `<root>/<name>.zip`。
 *  默认打全部；`npm run skill:build -- frameflow-film` 只打一个。 */
const ROOTS = ["public/skills", "skills"];
const only = process.argv[2];

async function walk(
  dir: string,
  root: string,
  name: string,
  files: Record<string, Uint8Array>,
) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, root, name, files);
    else {
      const data = await readFile(path);
      if (/\b(?:sk-|aic_|avp_)[A-Za-z0-9_-]{16,}/.test(data.toString()))
        throw new Error("Credential-like value found in public skill: " + path);
      files[name + "/" + relative(root, path).replaceAll("\\", "/")] = data;
    }
  }
}

async function main() {
  const found: { dir: string; name: string }[] = [];
  for (const rel of ROOTS) {
    let entries;
    try {
      entries = await readdir(join(process.cwd(), rel), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(process.cwd(), rel, entry.name);
      try {
        await readFile(join(dir, "SKILL.md"));
      } catch {
        continue;
      }
      found.push({ dir, name: entry.name });
    }
  }
  const targets = only ? found.filter((f) => f.name === only) : found;
  if (!targets.length)
    throw new Error("No skill found" + (only ? ": " + only : ""));
  for (const { dir, name } of targets) {
    const files: Record<string, Uint8Array> = {};
    await walk(dir, dir, name, files);
    await writeFile(join(dir, "..", name + ".zip"), zipSync(files));
    console.log(
      `Skill package built: ${name}.zip, ${Object.keys(files).length} files`,
    );
  }
}

void main();
