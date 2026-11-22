import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const host = process.env.TAURI_DEV_HOST;

const SKIP_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "$RECYCLE.BIN",
  "System Volume Information",
  ".git",
  "node_modules",
  ".svn",
  "__pycache__",
]);

function parsePureYear(name: string): number | null {
  const clean = name.trim().replace(/^#/, "").replace(/年$/, "").trim();
  if (/^\d{4}$/.test(clean)) {
    const y = Number(clean);
    if (y >= 1990 && y <= 2099) return y;
  }
  return null;
}

function parsePureMonth(name: string): number | null {
  const clean = name.trim().replace(/^#/, "").trim();
  const stripped = clean.replace(/月份?$/, "").trim();
  if (/^\d{1,2}$/.test(stripped)) {
    const m = Number(stripped);
    if (m >= 1 && m <= 12) return m;
  }
  const ym = clean.match(/^(\d{4})[-._](\d{2})$/);
  if (ym) {
    const m = Number(ym[2]);
    if (m >= 1 && m <= 12) return m;
  }
  return null;
}

function devArchivePlugin(): Plugin {
  return {
    name: "shibaplan-dev-archive",
    configureServer(server) {
      server.middlewares.use("/api/dev-archive/scan", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const { roots } = JSON.parse(body || "{}") as { roots?: string[] };
            const results: unknown[] = [];
            const maxEntries = 18000;

            const walk = (
              dir: string,
              rootDir: string,
              depth: number,
              insideProject: boolean,
              ctxYear: number | null,
              ctxMonth: number | null
            ) => {
              if (results.length >= maxEntries || depth > 5) return;
              let entries: fs.Dirent[];
              try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
              } catch {
                return;
              }
              for (const ent of entries) {
                if (results.length >= maxEntries) break;
                if (SKIP_NAMES.has(ent.name)) continue;
                const full = path.join(dir, ent.name);
                let stat: fs.Stats;
                try {
                  stat = fs.statSync(full);
                } catch {
                  continue;
                }
                const rel = path.relative(rootDir, full);
                if (ent.isDirectory()) {
                  if (!insideProject) {
                    const y = parsePureYear(ent.name);
                    if (y !== null) {
                      walk(full, rootDir, depth + 1, false, y, null);
                      continue;
                    }
                    const mo = parsePureMonth(ent.name);
                    if (mo !== null) {
                      const nextY =
                        ent.name.length === 7
                          ? Number(ent.name.slice(0, 4)) || ctxYear
                          : ctxYear;
                      walk(full, rootDir, depth + 1, false, nextY, mo);
                      continue;
                    }
                  }
                  const isProject = !insideProject;
                  let childCount = 0;
                  if (isProject) {
                    try {
                      childCount = fs.readdirSync(full).length;
                    } catch {
                      childCount = 0;
                    }
                  }
                  results.push({
                    name: ent.name,
                    path: full,
                    root_path: rootDir,
                    relative_path: rel,
                    is_dir: true,
                    is_project: isProject,
                    ext: "",
                    size: 0,
                    modified_ms: Math.floor(stat.mtimeMs),
                    context_year: ctxYear,
                    context_month: ctxMonth,
                    child_count: childCount,
                  });
                  if (depth < 4) {
                    walk(full, rootDir, depth + 1, true, ctxYear, ctxMonth);
                  }
                } else {
                  const ext = path.extname(ent.name).replace(/^\./, "").toLowerCase();
                  results.push({
                    name: ent.name,
                    path: full,
                    root_path: rootDir,
                    relative_path: rel,
                    is_dir: false,
                    is_project: !insideProject,
                    ext,
                    size: stat.size,
                    modified_ms: Math.floor(stat.mtimeMs),
                    context_year: ctxYear,
                    context_month: ctxMonth,
                    child_count: 0,
                  });
                }
              }
            };

            for (const raw of roots || []) {
              const clean = raw.trim().replace(/^"|"$/g, "");
              if (!clean || !fs.existsSync(clean)) continue;
              const initY = parsePureYear(path.basename(clean));
              walk(clean, clean, 0, false, initY, null);
            }

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(results));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });

      server.middlewares.use("/api/dev-archive/open", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const { path: targetPath } = JSON.parse(body || "{}") as {
              path?: string;
            };
            if (targetPath && fs.existsSync(targetPath)) {
              if (process.platform === "win32") {
                const isDir = fs.statSync(targetPath).isDirectory();
                if (isDir) {
                  spawn("explorer", [targetPath], { detached: true, stdio: "ignore" }).unref();
                } else {
                  spawn("cmd", ["/c", "start", "", targetPath], {
                    detached: true,
                    stdio: "ignore",
                  }).unref();
                }
              }
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false }));
          }
        });
      });
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), devArchivePlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
