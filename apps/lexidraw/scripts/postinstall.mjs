import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

async function main() {
  try {
    // Resolve chromium package location
    const resolved = import.meta.resolve("@sparticuz/chromium");
    const chromiumPath = resolved.replace(/^file:\/\//, "");
    const chromiumDir = dirname(dirname(dirname(chromiumPath))); // up from build/esm/index.js
    const binDir = join(chromiumDir, "bin");
    const libDir = join(chromiumDir, "lib");

    const publicDir = join(projectRoot, "public");
    const outTar = join(publicDir, "chromium-pack.tar");

    // Create tar archive in public folder (bin and lib)
    execSync(`mkdir -p ${publicDir}`);
    execSync(`tar -cf ${outTar} -C ${binDir} . -C ${libDir} .`);
    console.log("Created chromium-pack.tar in /public");
  } catch (err) {
    console.warn(
      "postinstall: unable to package chromium",
      err?.message || err,
    );
  }
}

await main();
