import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'web', 'dist');
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '127.0.0.1';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const candidate = path.resolve(root, `.${decoded}`);

  return candidate.startsWith(root) ? candidate : path.join(root, 'index.html');
}

async function fileForRequest(urlPath) {
  const candidate = safePath(urlPath);

  try {
    const info = await stat(candidate);
    return info.isDirectory() ? path.join(candidate, 'index.html') : candidate;
  } catch {
    return path.join(root, 'index.html');
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    const filePath = await fileForRequest(url.pathname);
    const body = await readFile(filePath);
    const type = contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream';

    response.writeHead(200, { 'Content-Type': type });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : 'Static server error');
  }
});

server.listen(port, host, () => {
  console.log(`StudyTube web serving ${root} at http://${host}:${port}`);
});
server.ref();
setInterval(() => undefined, 60_000);
