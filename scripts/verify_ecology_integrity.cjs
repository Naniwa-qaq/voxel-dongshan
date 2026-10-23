/* Verify original data hashes and the delivered local entry references. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),project=path.join(root,'东山镇_重制版');
const previous=JSON.parse(fs.readFileSync(path.join(project,'qa/unified-integrity.json'),'utf8'));
const sourceFiles=previous.sourceFiles.map(item=>{const p=path.join(root,'东山镇_数据',item.file);const actual=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');return{file:item.file,unchanged:actual===item.expectedSha256}});
const js=fs.readdirSync(path.join(project,'js')).filter(f=>f.endsWith('.js'));
for(const file of js)new vm.Script(fs.readFileSync(path.join(project,'js',file),'utf8'),{filename:file});
const references=[];
for(const file of ['index.html','README.html']){const text=fs.readFileSync(path.join(project,file),'utf8');for(const m of text.matchAll(/(?:src|href)="([^"]+)"/g)){const ref=m[1].split('#')[0].split('?')[0];if(!ref||/^(?:https?:|data:|mailto:)/.test(ref))continue;references.push({page:file,reference:ref,exists:fs.existsSync(path.resolve(project,path.dirname(file),decodeURI(ref)))})}}
const result={date:'2026-10-23',passed:sourceFiles.every(f=>f.unchanged)&&references.every(r=>r.exists),sourceFilesChecked:sourceFiles.length,jsFilesParsed:js.length,localReferencesChecked:references.length,missing:references.filter(r=>!r.exists),sourceFiles,references};
fs.writeFileSync(path.join(project,'qa/ecology-integrity.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.passed,sourceFiles:sourceFiles.length,jsFilesParsed:js.length,localReferences:references.length,missing:result.missing}));if(!result.passed)process.exitCode=1;
