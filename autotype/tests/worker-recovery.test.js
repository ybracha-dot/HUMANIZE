import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const delay = ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn) {
  for(let i=0;i<950;i++){ const value=await fn(); if(value) return value; await delay(20); }
  throw Error('fixture timed out');
}
async function boot(dir) {
  const worker=new Worker(new URL('./worker-fixture.js',import.meta.url),{workerData:{dir}});
  await once(worker,'message');
  const pending=new Map();
  let count=0;
  worker.on('message',({req,data})=>{pending.get(req)?.(data);pending.delete(req);});
  return {close:()=>worker.terminate(),send:(type,extras={})=>new Promise(resolve=>{
    const req=++count; pending.set(req,resolve);worker.postMessage({req,msg:{type,tabId:17,...extras}});
  })};
}
test('terminate the live worker mid-write, restore, reject stale review and resume exactly once', async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'autotype-test-'));
  const original='Some text to keep.';
  const addition=' A short review improves the draft.';
  const target=original+addition;
  const settings={wpm:230,variation:0,typoRate:0,secondThoughts:0,roughness:0,countdown:0};
  for (const k of ['editTime','reviewPause','sentencePause','paragraphPause','commaPause','citationPause']) {
    settings[k+'Min']=0; settings[k+'Max']=0;
  }
  for(const [key,value] of Object.entries({editor:original,local:{},session:{}}))
    await fs.writeFile(path.join(dir,key),JSON.stringify(value));
  let worker=await boot(dir);
  t.after(async()=>{await worker.close();await fs.rm(dir,{recursive:true,force:true})});
  const current=async()=>JSON.parse(await fs.readFile(path.join(dir,'editor'),'utf8'));
  assert.ok((await worker.send('autotype-start',{text:addition,settings})).ok);
  await until(async()=>{try{ const value=await current();return value.length>original.length+3 && value!==target; }catch{return false;}});
  await worker.close();
  worker=await boot(dir);
  const records=(await worker.send('autotype-recover-list')).records;
  assert.equal(records.length,1);
  const id=records[0].id;
  const preview=await worker.send('autotype-recover-preview',{id});
  assert.equal(preview.updated,target);
  assert.equal(preview.current,await current());
  assert.notEqual(preview.current,target);
  await worker.send('fixture-edit',{text:preview.current+' other'});
  assert.match((await worker.send('autotype-recover-start',{id,current:preview.current})).error,/Refresh/);
  assert.equal(await current(),preview.current+' other');
  await worker.send('fixture-edit',{text:preview.current});
  assert.ok((await worker.send('autotype-recover-start',{id,current:preview.current})).ok);
  const result=await until(async()=>{const {run}=await worker.send('autotype-get');return run.mode==='done' && run.result;});
  assert.equal(result.check,'match',JSON.stringify(result));
  assert.equal(await current(),target);
  assert.deepEqual((await worker.send('autotype-recover-list')).records,[]);
});
