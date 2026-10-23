const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const escape = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

(async () => {
  const { marked } = await import(pathToFileURL(require.resolve('C:/Users/YHJ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/marked')).href);
  const inputs = [
    ['深度解析与仿作指南.md','学习手册.html'],
    ['notes/01-美术风格详解.md','notes/01-美术风格详解.html'],
    ['notes/02-程序架构详解.md','notes/02-程序架构详解.html'],
    ['notes/03-学习与仿作练习.md','notes/03-学习与仿作练习.html']
  ];
  const style = `
  :root{color-scheme:light;--paper:#f4f0e6;--ink:#233730;--muted:#61736a;--accent:#2a6c58;--line:#d8dfd5}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:'Microsoft YaHei','Noto Sans SC',sans-serif;line-height:1.85;font-size:16px}
  header{padding:22px 32px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}header strong{font-size:19px}header span{font-size:13px;color:var(--muted)}
  .layout{max-width:1320px;margin:auto;display:grid;grid-template-columns:240px minmax(0,1fr);gap:38px;padding:34px 28px 80px}
  aside{align-self:start;position:sticky;top:24px;max-height:calc(100vh - 48px);overflow:auto;font-size:13px}aside nav{display:flex;flex-direction:column;gap:9px}aside a{line-height:1.6;color:var(--muted)}aside b{display:block;margin:22px 0 10px;color:var(--ink)}
  main{min-width:0;max-width:960px}h1{font-size:32px;line-height:1.35;letter-spacing:.02em;margin:0 0 24px}h2{font-size:24px;line-height:1.5;margin:52px 0 18px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:19px;margin:30px 0 12px}p{margin:16px 0}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  img{display:block;max-width:100%;height:auto;margin:24px auto}main img[src*='17-interface-mobile']{max-width:390px}code{font-family:Consolas,'Microsoft YaHei',monospace;font-size:.87em;overflow-wrap:anywhere}pre{overflow:auto;background:#e7eae0;padding:20px;line-height:1.65;border-radius:5px}pre code{overflow-wrap:normal}table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.75;margin:22px 0}th{text-align:left;background:#e6ebdf;font-weight:600}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}.table-scroll{overflow:auto}ul,ol{padding-left:26px}li{margin:7px 0}blockquote{margin:22px 0;padding:2px 22px;border-left:3px solid var(--accent);color:var(--muted)}footer{border-top:1px solid var(--line);padding:24px 32px;color:var(--muted);font-size:13px}.swatch{display:inline-block;width:13px;height:13px;margin-right:5px;vertical-align:-1px;border:1px solid rgba(0,0,0,.15)}
  @media(max-width:900px){.layout{grid-template-columns:1fr;padding:24px 18px 50px;gap:24px}aside{position:static;max-height:none}aside .toc{display:none}aside nav{flex-direction:row;flex-wrap:wrap;gap:8px 18px}aside b{margin:0 0 10px}header{padding:18px}h1{font-size:27px}h2{font-size:22px}table{min-width:570px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  `;
  for (const [input,output] of inputs) {
    const isNote=output.startsWith('notes/'), prefix=isNote?'../':'';
    let body=marked.parse(fs.readFileSync(path.join(root,input),'utf8'),{gfm:true});
    body=body.replace(/href="([^"]+)\.md"/g,(match,p)=>'href="'+p+'.html"');
    body=body.replace(/<table>/g,'<div class="table-scroll"><table>').replace(/<\/table>/g,'</table></div>');
    body=body.replace(/<code>(#[A-Fa-f0-9]{6})<\/code>/g,(_,color)=>'<span class="swatch" style="background:'+color+'" aria-hidden="true"></span><code>'+color+'</code>');
    const toc=[];let index=0;
    body=body.replace(/<h2>(.*?)<\/h2>/g,(_,label)=>{const id='section-'+(++index);toc.push('<a href="#'+id+'">'+label.replace(/<[^>]*>/g,'')+'</a>');return'<h2 id="'+id+'">'+label+'</h2>';});
    const title=body.match(/<h1>(.*?)<\/h1>/)?.[1].replace(/<[^>]*>/g,'')||'云山巨城学习档案';
    const nav=`<nav><a href="${prefix}学习手册.html">综合解析</a><a href="${prefix}notes/01-美术风格详解.html">美术详解</a><a href="${prefix}notes/02-程序架构详解.html">架构详解</a><a href="${prefix}notes/03-学习与仿作练习.html">练习路线</a><a href="${prefix}source/云山巨城.html">打开原作</a><a href="${path.basename(input)}">Markdown 源稿</a></nav>`;
    const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${style}</style></head><body><header><strong>云山巨城 · 学习档案</strong><span>源码事实 / 实际画面 / 仿作方法 · 2026-10-14</span></header><div class="layout"><aside><b>阅读入口</b>${nav}<div class="toc"><b>本页目录</b><nav>${toc.join('')}</nav></div></aside><main>${body}</main></div><footer>本阅读版仅使用本地资源。原作备份、截图及运行记录随档案保存。</footer></body></html>`;
    fs.writeFileSync(path.join(root,output),html,'utf8');
    console.log('Built '+output);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
