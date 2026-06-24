// Minimal stable static file server with SPA fallback for the LottaCash audit.
// Serves /home/z/my-project/audit-project/dist on 127.0.0.1:3000.
// Never crashes under load (no transforms, no HMR, just file reads).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || "/home/z/my-project/audit-project/dist";
const PORT = 3000;
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

const INDEX_HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    // Strip query/hash
    let filePath = path.join(ROOT, urlPath);
    // Prevent path traversal
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.stat(filePath, (err, stat) => {
      try {
        if (err || !stat.isFile()) {
          // SPA fallback: serve index.html for any non-file route
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(INDEX_HTML);
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end("Server error");
      }
    });
  } catch (e) {
    res.writeHead(500);
    res.end("Server error");
  }
});

server.on("error", (e) => {
  console.error("server error", e);
});

server.listen(PORT, HOST, () => {
  console.log(`LottaCash static audit server on http://${HOST}:${PORT}`);
});
