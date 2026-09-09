import test from 'node:test';
import assert from 'node:assert/strict';
import { imageType, fitDimensions, createId, dataUrlToBlob } from '../images.js';
import { shortestAngleDelta, unwrapAngle, createSphereMesh, quaternionFromAxisAngle, quaternionMultiply, quaternionInvert, rotateVectorByQuaternion } from '../math.js';
import { databaseRequest, PanoramaStore } from '../storage.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('images without MIME type, generic MIME types and uppercase extensions remain selectable', () => {
  assert.equal(imageType({name:'PANORAMA.JPG',type:''}), 'image/jpeg');
  assert.equal(imageType({name:'photo.jfif',type:'application/octet-stream'}), 'image/jpeg');
  assert.equal(imageType({name:'unnamed',type:'image/webp'}), 'image/webp');
  assert.equal(imageType({name:'malware.exe',type:''}), '');
});

test('large panoramas fit device limits and memory budget without stretching or upscaling', () => {
  assert.deepEqual(fitDimensions(16384,8192,4096,16*1024*1024), {width:4096,height:2048});
  assert.deepEqual(fitDimensions(1000,8000,2048), {width:256,height:2048});
  assert.deepEqual(fitDimensions(1024,512,8192), {width:1024,height:512});
  const size=fitDimensions(8192,4096,8192,16*1024*1024);
  assert.ok(size.width*size.height<=16*1024*1024);
  assert.ok(Math.abs(size.width/size.height-2)<0.001);
  assert.throws(()=>fitDimensions(0,100,4096));
});

test('legacy browsers do not require crypto.randomUUID', () => {
  const crypto={getRandomValues(bytes){bytes.fill(7);}};
  assert.match(createId(crypto), /^[a-z0-9]+-07070707070707070707070707070707$/);
});

test('image data import validates metadata and preserves binary bytes', async () => {
  const blob=dataUrlToBlob('data:image/png;base64,AAECA/8=');
  assert.equal(blob.type,'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0,1,2,3,255]);
  assert.throws(()=>dataUrlToBlob('data:text/html;base64,SGk='));
  assert.throws(()=>dataUrlToBlob('data:image/png;base64,'));
  assert.throws(()=>dataUrlToBlob('data:image/png;base64,%%%'));
});

test('seam crossings use the short route in both directions, including multiple turns', () => {
  assert.equal(shortestAngleDelta(-179,179),2);
  assert.equal(shortestAngleDelta(179,-179),-2);
  assert.equal(unwrapAngle(899,-179),901);
  assert.equal(shortestAngleDelta(720,0),0);
});

test('sphere retains corrected horizontal and vertical UV orientation', () => {
  const mesh=createSphereMesh(4,2);
  assert.deepEqual(mesh.uvs.slice(0,2), [1,1]);
  assert.deepEqual(mesh.uvs.slice(8,10), [0,1]);
  assert.deepEqual(mesh.uvs.slice(-2), [0,0]);
  assert.ok(mesh.indices.every(index=>index>=0&&index<mesh.positions.length/3));
  assert.equal(mesh.indices.length,4*2*6);
});

test('gyro reference removes initial orientation and retains corrected yaw axis', () => {
  const reference=quaternionFromAxisAngle([0,1,0],Math.PI/2);
  const relative=quaternionMultiply(quaternionInvert(reference),reference);
  const vector=rotateVectorByQuaternion([0,0,-1],relative);
  assert.ok(Math.abs(vector[0])<1e-12&&Math.abs(vector[2]+1)<1e-12);
});

test('writes resolve only after commit and reject a transaction abort after request success', async () => {
  let tx;
  const request={result:'stored'};
  const db={transaction(){tx={objectStore(){return {put(){return request;}};}};return tx;}};
  let resolved=false;
  const success=databaseRequest(db,'readwrite',s=>s.put({})).then(()=>resolved=true);
  await Promise.resolve();
  assert.equal(resolved,false);
  tx.oncomplete();
  await success;
  assert.equal(resolved,true);
  const failed=databaseRequest(db,'readwrite',s=>s.put({}));
  tx.error=new DOMException('Full','QuotaExceededError');
  tx.onabort();
  await assert.rejects(failed,{name:'QuotaExceededError'});
});

test('blocked storage keeps pictures usable in session and never reports them persisted', async () => {
  const store=await new PanoramaStore().init('test',null);
  assert.equal(await store.put({id:'a',createdAt:1,blob:new Blob(['test'])}),false);
  assert.equal((await store.get('a')).id,'a');
  assert.equal((await store.all()).length,1);
  await store.delete('a');
  assert.equal((await store.all()).length,0);
});

test('offline shell contains every application module and deletes only viewer caches', async () => {
  const source=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
  const handlers={};
  const scope='https://example.test/AI-360-VR-Viewer/';
  const cachePrefix=`ai-360-vr-viewer-${encodeURIComponent(scope)}-`;
  const removed=[];
  let installed=[];
  const cache={async addAll(requests){installed=requests.map(r=>r.url);},async match(url){return installed.includes(url)?new Response('cached'):undefined;}};
  vm.runInNewContext(source,{
    URL,Request,Set,
    self:{registration:{scope},addEventListener(name,handler){handlers[name]=handler;},async skipWaiting(){},clients:{async claim(){}}},
    caches:{async open(){return cache;},async keys(){return ['another-app', 'ai-360-vr-viewer-v9', `${cachePrefix}v9`, `${cachePrefix}v10`];},async delete(key){removed.push(key);}},
    fetch(){throw new Error('Offline');}
  });
  let job;
  handlers.install({waitUntil(promise){job=promise;}});
  await job;
  for(const file of ['app.js','viewer-app.js','app-bootstrap.js','storage.js','images.js','renderer.js','controls.js','math.js']){
    assert.ok(installed.includes(new URL(file,scope).href),file);
    await readFile(new URL('../'+file,import.meta.url));
  }
  handlers.activate({waitUntil(promise){job=promise;}});
  await job;
  assert.deepEqual(removed,['ai-360-vr-viewer-v9',`${cachePrefix}v9`]);
  let response;
  handlers.fetch({request:new Request(scope+'app.js?gyro-axis-fix=2'),respondWith(promise){response=promise;}});
  assert.equal(await (await response).text(),'cached');
});

test('stored binary originals reconstruct exactly and legacy Blob records remain readable', async()=>{
  const {restoreRecord}=await import('../storage.js');
  const bytes=new Uint8Array([0,1,255,12]).buffer;
  const record=restoreRecord({blob:bytes,type:'image/png',thumbnail:bytes,thumbnailType:'image/jpeg'});
  assert.equal(record.blob.type,'image/png');
  assert.deepEqual(new Uint8Array(await record.blob.arrayBuffer()),new Uint8Array(bytes));
  assert.equal(record.thumbnail.type,'image/jpeg');
  const legacy=new Blob(['legacy'],{type:'image/png'});
  assert.equal(restoreRecord({blob:legacy}).blob,legacy);
});
