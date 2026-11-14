import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

function files(dir){
 const out=[];
 for(const name of readdirSync(dir)){
  if(name==='node_modules'||name==='.next') continue;
  const path=join(dir,name);
  if(statSync(path).isDirectory()) out.push(...files(path));
  else if(/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
 }
 return out;
}

test('the web app never imports the WhatsApp Cloud API client',()=>{
 const offenders=files('web').filter(f=>/whatsapp\/src\/cloud/.test(readFileSync(f,'utf8')));
 assert.deepEqual(offenders,[]);
 const index=readFileSync('packages/whatsapp/src/index.ts','utf8');
 assert.doesNotMatch(index,/from ['"]\.\/cloud/);
});

test('only the agent process creates the Cloud API client',()=>{
 const users=[...files('engine'),...files('packages'),...files('web'),...files('scripts')]
  .filter(f=>!f.endsWith('cloud.ts')&&/createCloudProvider/.test(readFileSync(f,'utf8')));
 assert.deepEqual(users,['engine/src/agent/index.ts']);
});

test('the mock preview leaves the WhatsApp package alone',()=>{
 const mock=files('web').filter(f=>/(^|\/)mock|preview/.test(f)&&/packages\/whatsapp/.test(readFileSync(f,'utf8')));
 assert.deepEqual(mock,[]);
});
