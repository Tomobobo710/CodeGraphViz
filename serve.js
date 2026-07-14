const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || 8090;

http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/src/viewer/viewer.html' : req.url;
  const full = path.join(__dirname, decodeURIComponent(urlPath));
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(full);
    const type = ext === '.html' ? 'text/html' : ext === '.json' ? 'application/json' : 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}).listen(PORT, () => console.log(`serving on http://localhost:${PORT}`));
