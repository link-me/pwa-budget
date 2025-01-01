// Simple static server for local preview with no cache
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = process.env.PORT ? Number(process.env.PORT) : 9090;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function safePath(urlPath) {
  try {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const p = path.normalize(decoded).replace(/^\\+|\/+/, '');
    return path.join(root, p);
  } catch {
    return path.join(root, 'index.html');
  }
}

const server = http.createServer((req, res) => {
  let filePath = safePath(req.url);
  // Default to index.html for directories or missing files within directory root
  try {
    const stat = fs.existsSync(filePath) && fs.statSync(filePath);
    if (!stat) {
      // Try index.html at root
      filePath = path.join(root, 'index.html');
    } else if (stat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) filePath = indexPath; else filePath = path.join(root, 'index.html');
    }
  } catch {
    filePath = path.join(root, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    send(res, 200, data, { 'Content-Type': type });
  });
});

server.listen(port, () => {
  console.log(`[dev-server] Serving ${root} at http://127.0.0.1:${port}/`);
});