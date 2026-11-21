// Chrome API stand-ins for the worker integration test. File-backed state is
// shared across worker lifetimes; all action planning and recovery code is real.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { TextModel } from '../engine/plan.js';

const read = key => JSON.parse(fs.readFileSync(path.join(workerData.dir,key),'utf8'));
const write = (key,value) => fs.writeFileSync(path.join(workerData.dir,key),JSON.stringify(value));
const event = () => ({ addListener(fn) { this.fn = fn; } });
const noop = async () => {};
let page = new TextModel(read('editor'), '');
const store = key => ({
  async get(name) { const data=read(key); return name==null ? data : { [name]: data[name] }; },
  async set(values) { write(key,{...read(key),...values}); },
  async remove(name) { const data=read(key); delete data[name]; write(key,data); }
});
const url = 'https://example.test/draft';
const tab = { id: 17, title:'Test editor', url };
const current = () => ({ text:page.text, source:'box', box:'TEXTAREA#doc', caret:page.cur });
globalThis.chrome = {
  sidePanel:{ setPanelBehavior:noop, setOptions:noop }, action:{ onClicked:event(), setBadgeText:noop,setBadgeBackgroundColor:noop },
  runtime:{ getURL:p=>'chrome-extension://test/'+p, onInstalled:event(),onStartup:event(),onMessage:event(),sendMessage:noop,getPlatformInfo:async()=>({os:'linux'}) },
  storage:{local:store('local'),session:store('session')},tabs:{get:async()=>tab,sendMessage:async()=>current(),onUpdated:event()},
  commands:{onCommand:event()},debugger:{onDetach:event(),attach:noop,detach:noop,async sendCommand(_,method,x) {
    if(method==='Runtime.evaluate') return {result:{value:x.awaitPromise ? current():page.text}};
    if(method==='Input.insertText') { page.apply({k:'type',g:x.text}); }
    if(method==='Input.dispatchKeyEvent' && x.type!=='keyUp') {
      const mapping={Home:'docstart',End:'docend',ArrowLeft:'left',ArrowRight:'right',Backspace:'back',Enter:'enter'};
      if(x.text && x.key!=='Enter') page.apply({k:'type',g:x.text});
      else if(mapping[x.key]) page.apply({k:mapping[x.key],sh:!!(x.modifiers&8)});
    }
    write('editor',page.text);
    return {};
  }}
};
await import('../background.js');
parentPort.on('message',async ({req,msg})=>{
  if(msg.type==='fixture-edit') { page=new TextModel(msg.text,''); write('editor',page.text);parentPort.postMessage({req,data:{}});return; }
  chrome.runtime.onMessage.fn(msg,{url:'chrome-extension://test/sidepanel.html?tab=17'},data=>parentPort.postMessage({req,data}));
});
parentPort.postMessage({ready:true});
