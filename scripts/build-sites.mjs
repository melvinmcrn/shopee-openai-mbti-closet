import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";

const contentTypes = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
};

const assets = {};
for (const file of await readdir("out", { recursive: true, withFileTypes: true })) {
  if (!file.isFile()) continue;
  const path = join(file.parentPath, file.name);
  const type = contentTypes[file.name.split(".").pop()] ?? "application/octet-stream";
  assets["/" + relative("out", path)] = [type, (await readFile(path)).toString("base64")];
}

await build({
  entryPoints: ["worker/index.mjs"],
  outfile: "dist/server/index.js",
  platform: "browser",
  format: "esm",
  bundle: true,
  define: { SITE_ASSETS: JSON.stringify(assets) },
});

const hostingManifest = ".openai/hosting.json";
const { d1 } = JSON.parse(await readFile(hostingManifest, "utf8"));
await mkdir("dist/.openai", { recursive: true });
await cp(hostingManifest, "dist/.openai/hosting.json");

const deploymentMigrations = "dist/drizzle";
await rm(deploymentMigrations, { recursive: true, force: true });
if (d1) {
  await cp("drizzle", deploymentMigrations, { recursive: true });
}
