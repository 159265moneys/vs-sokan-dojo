import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream",
};
http
  .createServer((req, res) => {
    let p;
    try {
      p = path.resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!p.startsWith(root + path.sep) && p !== root) {
      res.writeHead(403).end();
      return;
    }
    if (p === root) p += "/index.html";
    fs.stat(p, (e, s) => {
      if (e || !s.isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(p)] || "application/octet-stream",
        "Cache-Control": p.includes("/engine/")
          ? "public, max-age=86400"
          : "no-cache",
      });
      fs.createReadStream(p).pipe(res);
    });
  })
  .listen(4173, "127.0.0.1", () => console.log("Local: http://127.0.0.1:4173"));
