const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5500;
const DIR = __dirname;
const MIME = { html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8' };

const SPA_ROUTES = ['/', '/dashboard', '/issues', '/create', '/log', '/time', '/summary', '/assistant'];

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (SPA_ROUTES.includes(urlPath)) {
    fs.readFile(path.join(DIR, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(data);
    });
  } else {
    const file = path.join(DIR, urlPath);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = file.split('.').pop();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'text/plain',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(data);
    });
  }
}).listen(PORT, () => console.log('Server running at http://localhost:' + PORT));
