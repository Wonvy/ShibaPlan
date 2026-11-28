import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
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

const PREVIEW_IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "gif",
  "svg",
  "avif",
]);

function findDevThumbnail(dir: string): string | null {
  let bestScore = -1;
  let bestPath: string | null = null;
  let visited = 0;

  const scan = (cur: string, depth: number) => {
    if (depth > 2 || visited > 140) return;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const it of items) {
      visited++;
      if (visited > 140) break;
      if (SKIP_NAMES.has(it.name) || it.name === "__MACOSX") continue;
      const full = path.join(cur, it.name);
      if (it.isDirectory()) {
        if (depth < 2) subdirs.push(full);
        continue;
      }
      const ext = path.extname(it.name).replace(/^\./, "").toLowerCase();
      if (!PREVIEW_IMAGE_EXTS.has(ext)) continue;
      let sz = 0;
      try {
        sz = fs.statSync(full).size;
      } catch {
        continue;
      }
      if (sz < 1024 || sz > 15_000_000) continue;
      let score = depth === 0 ? 40 : depth === 1 ? 25 : 10;
      if (["jpg", "jpeg", "png", "webp"].includes(ext)) score += 15;
      const lower = it.name.toLowerCase();
      if (
        /(cover|thumb|preview|final|render|poster|logo|main|封面|效果|成品|海报|主图|展示|定稿|终稿|渲染)/.test(
          lower
        )
      ) {
        score += 80;
      }
      if (score > bestScore) {
        bestScore = score;
        bestPath = full;
      }
    }
    for (const s of subdirs) scan(s, depth + 1);
  };

  scan(dir, 0);
  return bestPath;
}

function devArchivePlugin(): Plugin {
  const defaultWorkspaceFile = path.join(
    os.homedir(),
    "Documents",
    "ShibaPlan",
    "shibaplan-data.json"
  );

  const resolveDevDataDir = (explicitCustomDir?: string): string => {
    const trimmed = (explicitCustomDir || "").trim();
    if (trimmed) return trimmed;
    try {
      if (fs.existsSync(defaultWorkspaceFile)) {
        const raw = fs.readFileSync(defaultWorkspaceFile, "utf-8");
        const parsed = JSON.parse(raw) as {
          settings?: { customDataDir?: string };
        };
        const cfgDir = parsed?.settings?.customDataDir?.trim();
        if (cfgDir) return cfgDir;
      }
    } catch {
      // ignore
    }
    return path.dirname(defaultWorkspaceFile);
  };

  return {
    name: "shibaplan-dev-archive",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) {
          const [pathname, search] = req.url.split("?");
          if (
            pathname === "/docs" ||
            (pathname.startsWith("/docs/") && pathname.endsWith("/"))
          ) {
            const relIndex = pathname.endsWith("/")
              ? `${pathname}index.html`
              : `${pathname}/index.html`;
            const diskFile = path.join(
              process.cwd(),
              "public",
              relIndex.replace(/^\/+/, "")
            );
            if (fs.existsSync(diskFile)) {
              req.url = relIndex + (search ? `?${search}` : "");
            }
          }
        }
        next();
      });

      server.middlewares.use("/api/assets", (req, res, next) => {
        if (req.method === "GET") {
          try {
            const rawSub = (req.url || "").split("?")[0].replace(/^\/+/, "");
            const fileName = decodeURIComponent(rawSub);
            if (
              !fileName ||
              fileName.includes("/") ||
              fileName.includes("\\") ||
              fileName.includes("..")
            ) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const filePath = path.join(resolveDevDataDir(), "assets", fileName);
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
              res.statusCode = 404;
              res.end();
              return;
            }
            const ext = path.extname(fileName).replace(/^\./, "").toLowerCase();
            const mimeMap: Record<string, string> = {
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              webp: "image/webp",
              gif: "image/gif",
              bmp: "image/bmp",
              svg: "image/svg+xml",
              avif: "image/avif",
              ico: "image/x-icon",
            };
            res.setHeader(
              "Content-Type",
              mimeMap[ext] || "application/octet-stream"
            );
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            fs.createReadStream(filePath).pipe(res);
          } catch {
            res.statusCode = 500;
            res.end();
          }
          return;
        }

        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const payload = JSON.parse(body || "{}") as {
                base64Data?: string;
                ext?: string;
                customDir?: string;
              };
              const rawB64 = (payload.base64Data || "").trim();
              if (!rawB64) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "Empty image data" }));
                return;
              }
              const cleanB64 = rawB64.includes(",")
                ? rawB64.slice(rawB64.indexOf(",") + 1).trim()
                : rawB64;
              const bytes = Buffer.from(cleanB64, "base64");
              const safeExt =
                (payload.ext || "png")
                  .replace(/[^a-zA-Z0-9]/g, "")
                  .toLowerCase() || "png";
              const now = new Date();
              const pad = (n: number, len = 2) => String(n).padStart(len, "0");
              const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
                now.getDate()
              )}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(
                now.getSeconds()
              )}_${pad(now.getMilliseconds(), 3)}`;
              const fileName = `shot_${ts}.${safeExt}`;
              const assetsDir = path.join(
                resolveDevDataDir(payload.customDir),
                "assets"
              );
              fs.mkdirSync(assetsDir, { recursive: true });
              const fullPath = path.join(assetsDir, fileName);
              fs.writeFileSync(fullPath, bytes);
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify({
                  ok: true,
                  path: fullPath,
                  relativePath: `assets/${fileName}`,
                })
              );
            } catch (err) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });
          return;
        }

        return next();
      });

      server.middlewares.use("/api/workspace", (req, res, next) => {
        if (req.method === "GET") {
          try {
            if (fs.existsSync(defaultWorkspaceFile)) {
              const raw = fs.readFileSync(defaultWorkspaceFile, "utf-8");
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(raw);
              return;
            }
          } catch {
            // fall through
          }
          res.statusCode = 404;
          res.end();
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              fs.mkdirSync(path.dirname(defaultWorkspaceFile), { recursive: true });
              fs.writeFileSync(defaultWorkspaceFile, body, "utf-8");
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: true }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });
          return;
        }
        return next();
      });

      server.middlewares.use("/api/dev-archive/explorer", (req, res, next) => {
        if (req.method !== "POST") return next();
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const { folderPath } = JSON.parse(body || "{}") as { folderPath?: string };
            const clean = (folderPath || "").trim();
            if (!clean || !fs.existsSync(clean)) {
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify([]));
              return;
            }
            const items = fs.readdirSync(clean, { withFileTypes: true });
            const out: {
              name: string;
              path: string;
              is_dir: boolean;
              ext: string;
              size: number;
              modified_ms: number;
            }[] = [];
            for (const it of items) {
              if (SKIP_NAMES.has(it.name)) continue;
              const full = path.join(clean, it.name);
              try {
                const st = fs.statSync(full);
                const isDir = st.isDirectory();
                out.push({
                  name: it.name,
                  path: full,
                  is_dir: isDir,
                  ext: isDir ? "" : path.extname(it.name).replace(/^\./, "").toLowerCase(),
                  size: isDir ? 0 : st.size,
                  modified_ms: Math.floor(st.mtimeMs),
                });
              } catch {
                // skip
              }
            }
            out.sort((a, b) =>
              a.is_dir !== b.is_dir
                ? a.is_dir
                  ? -1
                  : 1
                : a.name.localeCompare(b.name)
            );
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify(out.slice(0, 300)));
          } catch {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify([]));
          }
        });
      });

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
                  let thumbnailPath: string | null = null;
                  if (isProject) {
                    try {
                      childCount = fs.readdirSync(full).length;
                    } catch {
                      childCount = 0;
                    }
                    thumbnailPath = findDevThumbnail(full);
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
                    thumbnail_path: thumbnailPath,
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
                    thumbnail_path:
                      PREVIEW_IMAGE_EXTS.has(ext) && stat.size <= 15_000_000
                        ? full
                        : null,
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

      server.middlewares.use("/api/dev-archive/thumb", (req, res, next) => {
        if (req.method !== "GET") return next();
        try {
          const url = new URL(req.url || "", "http://localhost");
          const filePath = url.searchParams.get("path") || "";
          if (!filePath || !fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
          const mimeMap: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            webp: "image/webp",
            gif: "image/gif",
            bmp: "image/bmp",
            svg: "image/svg+xml",
            avif: "image/avif",
          };
          res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=3600");
          fs.createReadStream(filePath).pipe(res);
        } catch {
          res.statusCode = 500;
          res.end();
        }
      });

      server.middlewares.use("/api/ai-proxy", (req, res, next) => {
        if (req.method !== "POST") return next();
        let rawBody = "";
        req.on("data", (chunk) => (rawBody += chunk));
        req.on("end", async () => {
          try {
            const payload = JSON.parse(rawBody || "{}") as {
              url?: string;
              method?: string;
              headers?: Record<string, string>;
              body?: string;
            };
            const targetUrl = (payload.url || "").trim();
            if (
              !targetUrl.startsWith("http://") &&
              !targetUrl.startsWith("https://")
            ) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, status: 400, error: "Invalid target URL" }));
              return;
            }
            const method = payload.method === "GET" ? "GET" : "POST";
            const upstream = await fetch(targetUrl, {
              method,
              headers: payload.headers || {},
              body: method === "POST" ? payload.body : undefined,
            });
            const text = await upstream.text();
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: upstream.ok,
                status: upstream.status,
                body: text,
              })
            );
          } catch (err) {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                ok: false,
                status: 0,
                error: err instanceof Error ? err.message : String(err),
              })
            );
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
  cacheDir: "node_modules/.vite-v2",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
