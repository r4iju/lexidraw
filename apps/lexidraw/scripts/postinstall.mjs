import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

async function main() {
  try {
    // Resolve chromium package location robustly across package managers
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("@sparticuz/chromium/package.json");
    const chromiumDir = dirname(pkgJsonPath);
    const binDir = join(chromiumDir, "bin");

    const publicDir = join(projectRoot, "public");
    const outTar = join(publicDir, "chromium-pack.tar");

    // Create tar archive in public folder with bin contents at tar root
    // -h dereferences symlinks (important with bun)
    execSync(`mkdir -p ${publicDir}`);
    execSync(`tar -chf ${outTar} -C ${binDir} .`);
    console.log("Created chromium-pack.tar in /public");
  } catch (err) {
    console.warn(
      "postinstall: unable to package chromium",
      err?.message || err,
    );
  }
}

await main();
