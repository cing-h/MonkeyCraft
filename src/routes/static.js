// Serves the browser UI from ui/. Only files inside ui/ can be served.

import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export function staticRoutes({ fsp, uiDir }) {
  const serve = async (res, rel) => {
    const file = path.resolve(uiDir, '.' + path.posix.normalize('/' + rel));
    if (!file.startsWith(uiDir + path.sep)) { res.writeHead(404); return res.end(); }
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'",
        'x-content-type-options': 'nosniff'
      });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  };
  return [
    { method: 'GET', path: '/', handle: ({ res }) => serve(res, 'index.html') },
    { method: 'GET', path: /^\/ui\/(.+)$/, handle: ({ res, params }) => serve(res, params[0]) }
  ];
}
