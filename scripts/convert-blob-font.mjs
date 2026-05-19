import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TTFLoader } from "three/addons/loaders/TTFLoader.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ttfPath = join(root, "public/fonts/Blob-Regular.ttf");
const outPath = join(root, "public/fonts/Blob-Regular.typeface.json");

const loader = new TTFLoader();
const buffer = readFileSync(ttfPath);
const json = loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

writeFileSync(outPath, JSON.stringify(json));
console.log(`Wrote ${outPath}`);
