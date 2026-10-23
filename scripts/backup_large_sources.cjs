/* Losslessly compress the large source snapshot for regular Git storage. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Writable}=require('node:stream');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'东山镇_数据/overture');
const source='buildings_bbox_2026-09-23.1.geojson',archive=source+'.gz';
async function digest(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex')}
(async()=>{const input=path.join(folder,source),output=path.join(folder,archive),before=await digest(input);
  await pipeline(fs.createReadStream(input),zlib.createGzip({level:9}),fs.createWriteStream(output));
  const restored=crypto.createHash('sha256');let decodedBytes=0;await pipeline(fs.createReadStream(output),zlib.createGunzip(),new Writable({write(chunk,encoding,callback){decodedBytes+=chunk.length;restored.update(chunk);callback()}}));
  if(restored.digest('hex')!==before||await digest(input)!==before)throw new Error('Backup or source checksum mismatch');
  const info={schemaVersion:1,source,archive,sourceBytes:fs.statSync(input).size,archiveBytes:fs.statSync(output).size,
    sourceSha256:before,archiveSha256:await digest(output),restoredBytesVerified:decodedBytes,restoreCommand:'python scripts/restore_large_sources.py',
    note:'Original source is Git-ignored because it exceeds 100MiB. Gzip decoding reproduces its exact bytes; original source remains unchanged locally.'};
  fs.writeFileSync(path.join(folder,'large-source-backup.json'),JSON.stringify(info,null,2)+'\n');console.log(JSON.stringify(info,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
