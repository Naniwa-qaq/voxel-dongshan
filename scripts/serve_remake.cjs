const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.md':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{let relative;try{relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400);return res.end()};let target=path.resolve(root,'.'+relative);if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);return res.end()};if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');fs.readFile(target,(error,data)=>{if(error){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)})});
server.listen(8876,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8876/'));
