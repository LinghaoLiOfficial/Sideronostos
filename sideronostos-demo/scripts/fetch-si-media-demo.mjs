// The demo ships the SI videos as public assets. Fail early if a deployment
// checkout is missing one, rather than silently rendering poster-only pages.
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

if (process.env.VERCEL === "1") {
  console.log("Vercel build: using the configured remote SI media base URL.");
  process.exit(0);
}

try {
  const manifest = JSON.parse(await readFile(new URL("./si-media.json", import.meta.url), "utf8"));
  for (const name of Object.keys(manifest)) {
    await access(new URL(`../public/videos/si/${name}`, import.meta.url), constants.R_OK);
  }
  console.log(`Demo media ready: verified ${Object.keys(manifest).length} local SI videos.`);
} catch {
  throw new Error("Demo SI videos are missing. Copy public/videos/si from sideronostos-frontend before building.");
}
