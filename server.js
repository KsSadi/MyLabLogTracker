const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5500;
const DIR = __dirname;
const MIME = { html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json' };

http.createServer((req, res) => {
  const file = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = file.split('.').pop();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Server running at http://localhost:' + PORT));
