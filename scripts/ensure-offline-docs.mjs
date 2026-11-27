import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const indexHtml = path.resolve(process.cwd(), "public", "docs", "index.html");

if (!fs.existsSync(indexHtml)) {
  console.log("[ShibaPlan] Building offline documentation into public/docs ...");
  execSync("npx vitepress build docs", { stdio: "inherit" });
}
