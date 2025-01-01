// Simple static server for local preview with no cache
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = process.env.PORT ? Number(process.env.PORT) : 9090;
const host = process.env.HOST || '0.0.0.0';

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

function versionFor(filePath) {
  try {
    const st = fs.statSync(filePath);
    return String(Math.floor(st.mtimeMs));
  } catch { return String(Date.now()); }
}

function rewriteJS(content, filePath) {
  const dir = path.dirname(filePath);
  function rewriteSpec(spec) {
    try {
      const base = spec.split('?')[0];
      if (/^\.|^\//.test(base)) {
        const target = path.resolve(dir, base.replace(/^\//, ''));
        const v = versionFor(target);
        return `${base}?v=${v}`;
      }
      return spec;
    } catch { return spec; }
  }
  // import ... from '...'
  content = content.replace(/(import\s+[^'"\n]*?from\s+['"])([^'"]+)(['"])/g, (m, p1, spec, p3) => `${p1}${rewriteSpec(spec)}${p3}`);
  // bare import '...'
  content = content.replace(/(import\s+['"])([^'"]+)(['"])/g, (m, p1, spec, p3) => `${p1}${rewriteSpec(spec)}${p3}`);
  // dynamic import('...')
  content = content.replace(/(import\s*\(\s*['"])([^'"]+)(['"]\s*\))/g, (m, p1, spec, p3) => `${p1}${rewriteSpec(spec)}${p3}`);
  return content;
}

function rewriteHTML(content, filePath) {
  const dir = path.dirname(filePath);
  function rewriteAttr(attr, val) {
    try {
      const base = val.split('?')[0];
      const target = path.resolve(dir, base.replace(/^\//, ''));
      const v = versionFor(target);
      return `${base}?v=${v}`;
    } catch { return val; }
  }
  // <script type="module" src="...">
  content = content.replace(/(<script[^>]*src=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, src, p3) => `${p1}${rewriteAttr('src', src)}${p3}`);
  // <link rel="stylesheet" href="...">
  content = content.replace(/(<link[^>]*href=["'])([^"']+)(["'][^>]*>)/gi, (m, p1, href, p3) => `${p1}${rewriteAttr('href', href)}${p3}`);
  return content;
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
    let body = data;
    try {
      if (ext === '.html') {
        body = Buffer.from(rewriteHTML(body.toString('utf-8'), filePath), 'utf-8');
      } else if (ext === '.js' || ext === '.mjs') {
        body = Buffer.from(rewriteJS(body.toString('utf-8'), filePath), 'utf-8');
      }
    } catch {}
    send(res, 200, body, { 'Content-Type': type });
  });
});

server.listen(port, host, () => {
  try {
    const addr = server.address();
    const actualPort = (addr && typeof addr === 'object' && addr.port) ? addr.port : port;
    const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log(`[dev-server] Serving ${root} at http://${shownHost}:${actualPort}/`);
  } catch {
    const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host;
    console.log(`[dev-server] Serving ${root} at http://${shownHost}:${port}/`);
  }
});