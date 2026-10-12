import sharp from "sharp";
import { writeFile } from "node:fs/promises";

// Export the approved generated artwork; do not redraw or alter the mark.
const source = "public/brand/frameflow-source.png";
for (const [path, size] of [
  ["src/app/icon.png", 32],
  ["src/app/apple-icon.png", 180],
  ["public/brand/frameflow-mark.png", 96],
  ["public/brand/frameflow-512.png", 512],
]) {
  await sharp(source).resize(size, size).png().toFile(path);
}

const sizes = [16, 32, 48, 64, 256];
const images = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).ensureAlpha().png().toBuffer()),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((data, index) => {
  const position = 6 + index * 16;
  header[position] = sizes[index] % 256;
  header[position + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, position + 4);
  header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(data.length, position + 8);
  header.writeUInt32LE(offset, position + 12);
  offset += data.length;
});
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...images]));
console.log("Exported Frameflow favicon, touch icon and brand assets.");
