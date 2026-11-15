import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const release = "https://github.com/qiongwenz748-odie/Sideronostos/releases/download/si-media-v1/";
const directory = new URL("../public/videos/si/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("si-media.json", import.meta.url), "utf8"));

async function matches(file, { size, sha256 }) {
  const info = await stat(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (info?.size !== size) return false;

  const checksum = createHash("sha256");
  for await (const chunk of createReadStream(file)) checksum.update(chunk);
  return checksum.digest("hex") === sha256;
}

await mkdir(directory, { recursive: true });
for (const [name, expected] of Object.entries(manifest)) {
  const file = new URL(name, directory);
  if (await matches(file, expected)) continue;

  console.log(`Downloading ${name} (${Math.round(expected.size / 1_000_000)} MB)`);
  const pending = new URL(`${name}.${randomUUID()}.part`, directory);
  try {
    const response = await fetch(new URL(name, release));
    if (!response.ok || !response.body) throw new Error(`Download returned HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(pending, { flags: "wx" }));
    if (!await matches(pending, expected)) throw new Error("The SHA-256 checksum or size did not match the manifest");
    await rename(pending, file);
  } catch (error) {
    throw new Error(`Could not prepare ${name}. Run pnpm media:sync to retry.`, { cause: error });
  } finally {
    await rm(pending, { force: true });
  }
}
