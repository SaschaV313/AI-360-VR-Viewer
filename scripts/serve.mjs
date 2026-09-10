import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { existsSync } from 'node:fs';
const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const root = resolve(value('--root') || '.');
const port = Number(value('--port') || process.env.PORT || 4173);
const host = value('--host') || '0.0.0.0';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
createServer(async (request, response) => {
  // Test-only network outage, independent of browser automation's offline flag.
  if (existsSync(resolve(root, '.test-offline'))) { request.socket.destroy(); return; }
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // Exercise GitHub Pages subdirectory resolution in the same local server.
    if (pathname.startsWith('/AI-360-VR-Viewer/')) pathname = pathname.slice('/AI-360-VR-Viewer'.length);
    if (pathname.split('/').some(part => part.startsWith('.'))) throw new Error('Forbidden');
    let path = resolve(root, `.${pathname}`);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Forbidden');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, host, () => console.log(`Viewer server ready on port ${port}`));
