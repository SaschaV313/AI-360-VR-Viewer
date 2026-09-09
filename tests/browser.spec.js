import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const png = await readFile(new URL('./fixtures/panorama.png', import.meta.url));
const upload = (page, name='panorama.png', mimeType='image/png', buffer=png) => page.locator('#fileInput').setInputFiles({name,mimeType,buffer});
async function ready(page) {
  await page.goto('./');
  await expect(page.locator('#fileInput')).toBeEnabled();
  await expect(page.locator('#viewer canvas')).toHaveCount(1);
}
async function gallery(page) {
  if (await page.locator('#galleryPanel').getAttribute('aria-hidden') === 'true') await page.getByRole('button',{name:'Galerie öffnen'}).click();
}
async function loaded(page, name='panorama.png') {
  await expect(page.locator('#placeholderOverlay')).toHaveAttribute('aria-hidden','true');
  await expect(page.locator('.thumb.active')).toHaveAttribute('title',name);
  await expect(page.locator('#fileInput')).toBeEnabled();
  await expect(page.locator('#loadStatus')).toHaveText('');
}

test('fresh startup, upload, small preview and reload retain original bytes', async ({page}) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await ready(page);
  await upload(page);
  await loaded(page);
  const stored = await page.evaluate(async () => {
    const {openDatabase,databaseRequest}=await import('./storage.js');
    const db=await openDatabase();
    const [record]=await databaseRequest(db,'readonly',store=>store.getAll());
    db.close();
    const preview=await createImageBitmap(record.thumbnail);
    const result={size:record.blob.size,constructor:record.blob.constructor.name,previewWidth:preview.width};
    preview.close();
    return result;
  });
  expect(stored.size).toBe(png.length);
  expect(stored.constructor).toBe('Blob');
  expect(stored.previewWidth).toBeLessThanOrEqual(320);
  await page.reload();
  await loaded(page);
  expect(errors).toEqual([]);
});

test('empty version-1 database is repaired automatically', async ({page}) => {
  await page.goto('./tests/blank.html');
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('ai-360-vr-viewer',1);
    request.onsuccess=()=>{request.result.close();resolve();};
    request.onerror=()=>reject(request.error);
  }));
  await ready(page);
  await upload(page);
  await loaded(page);
});

test('existing version-1 gallery migrates without losing its stored image', async ({page}) => {
  await page.goto('./tests/blank.html');
  await page.evaluate(async () => {
    const blob=await (await fetch('./fixtures/panorama.png')).blob();
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('ai-360-vr-viewer',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('panoramas',{keyPath:'id'});
      request.onsuccess=()=>{
        const db=request.result;
        const tx=db.transaction('panoramas','readwrite');
        tx.objectStore('panoramas').put({id:'legacy',name:'legacy.png',createdAt:1,blob,size:blob.size});
        tx.oncomplete=()=>{db.close();resolve();};
        tx.onabort=()=>reject(tx.error);
      };
    });
  });
  await ready(page);
  await loaded(page,'legacy.png');
  await expect(page.locator('.thumb')).toHaveCount(1);
});

test('files without image MIME and UUID support load through the extension fallback', async ({page}) => {
  await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
  await ready(page);
  await upload(page,'PANORAMA.PNG','');
  await loaded(page,'PANORAMA.PNG');
});

test('blocked blob URLs fall back to FileReader', async ({page}) => {
  await page.addInitScript(()=>{URL.createObjectURL=()=>{throw new Error('Blob URLs blocked for test');};});
  await ready(page);
  await upload(page);
  await loaded(page);
});

test('unavailable persistent storage still permits viewing and export', async ({page}) => {
  await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Disabled for test','SecurityError');},configurable:true}));
  await ready(page);
  await upload(page);
  await loaded(page);
  await gallery(page);
  await expect(page.locator('#storageNotice')).toBeVisible();
  await expect(page.locator('#operationStatus')).toContainText('0 dauerhaft gespeichert');
  await expect(page.locator('#exportGallery')).toBeEnabled();
});

test('a damaged upload cannot replace the active panorama or create a gallery record', async ({page}) => {
  await ready(page);
  await upload(page);
  await loaded(page);
  await gallery(page);
  await upload(page,'broken.png','image/png',Buffer.from('not an image'));
  await expect(page.locator('#operationStatus')).toContainText('broken.png');
  await expect(page.locator('#operationStatus')).toContainText('0 Bilder');
  await expect(page.locator('.thumb')).toHaveCount(1);
  await expect(page.locator('.thumb.active')).toHaveAttribute('title','panorama.png');
  await expect(page.locator('#placeholderOverlay')).toHaveAttribute('aria-hidden','true');
});

test('large image respects a smaller device texture limit', async ({page}) => {
  await page.addInitScript(()=>{
    const getParameter=WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter=function(parameter){
      return parameter===this.MAX_TEXTURE_SIZE?512:getParameter.call(this,parameter);
    };
  });
  await ready(page);
  await upload(page);
  await loaded(page);
  await expect(page.locator('#toast')).toContainText('512 × 256');
});

test('mixed uploads report partial success and reset the file input for reselection', async ({page}) => {
  await ready(page);
  await page.locator('#fileInput').setInputFiles([
    {name:'bad.jpg',mimeType:'image/jpeg',buffer:Buffer.from('broken')},
    {name:'good.png',mimeType:'image/png',buffer:png},
  ]);
  await loaded(page,'good.png');
  await expect(page.locator('#operationStatus')).toContainText('1 Bild hinzugefügt');
  await expect(page.locator('#operationStatus')).toContainText('bad.jpg');
  await expect(page.locator('#fileInput')).toHaveValue('');
  await upload(page,'good.png');
  await expect(page.locator('.thumb')).toHaveCount(2);
});

test('export and import round trip preserves image bytes, then deletion returns to placeholder', async ({page}) => {
  await ready(page);
  await upload(page);
  await loaded(page);
  await gallery(page);
  const pending=page.waitForEvent('download');
  await page.locator('#exportGallery').click();
  const download=await pending;
  const payload=JSON.parse(await readFile(await download.path(),'utf8'));
  expect(Buffer.from(payload.items[0].dataUrl.split(',')[1],'base64')).toEqual(png);
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#clearGallery').click();
  await expect(page.locator('.thumb')).toHaveCount(0);
  await expect(page.locator('#placeholderOverlay')).toHaveAttribute('aria-hidden','false');
  await page.locator('#importInput').setInputFiles({name:'gallery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  await loaded(page);
  await gallery(page);
  await page.locator('#deleteCurrent').click();
  await expect(page.locator('.thumb')).toHaveCount(0);
  await expect(page.locator('#placeholderOverlay')).toHaveAttribute('aria-hidden','false');
});

test('mobile layout keeps upload and close controls accessible', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await ready(page);
  const box=await page.locator('#fileInput').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'Schließen',exact:true}).click();
  await expect(page.locator('#galleryPanel')).toHaveAttribute('aria-hidden','true');
  await page.getByRole('button',{name:'Galerie öffnen'}).click();
  await upload(page);
  await loaded(page);
});

test.describe('offline installation',()=>{
  test.use({serviceWorkers:'allow'});
  test('installed app shell and stored panorama reopen offline at the Pages subpath',async ({page,context})=>{
    await ready(page);
    await upload(page);
    await loaded(page);
    await page.evaluate(async()=>{
      await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    });
    await context.setOffline(true);
    await page.reload();
    await loaded(page);
    await gallery(page);
    await upload(page,'offline.png');
    await loaded(page,'offline.png');
  });
});

test('a slow older selection cannot overwrite the most recent gallery selection',async ({page})=>{
  await ready(page);
  await page.locator('#fileInput').setInputFiles([
    {name:'first.png',mimeType:'image/png',buffer:png},
    {name:'second.png',mimeType:'image/png',buffer:png},
  ]);
  await loaded(page,'first.png');
  await gallery(page);
  await expect.poll(()=>page.locator('.thumb img').evaluateAll(images=>images.every(image=>image.complete))).toBe(true);
  await page.evaluate(()=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    let delayed=false;
    window.testDelayedImageStarted=false;
    Object.defineProperty(HTMLImageElement.prototype,'src',{
      ...descriptor,
      set(value){
        if(!delayed&&String(value).startsWith('blob:')){
          delayed=true;
          window.testDelayedImageStarted=true;
          setTimeout(()=>descriptor.set.call(this,value),300);
        } else descriptor.set.call(this,value);
      }
    });
  });
  await page.locator('.thumb[title="second.png"]').click();
  await expect.poll(()=>page.evaluate(()=>window.testDelayedImageStarted)).toBe(true);
  await page.locator('.thumb[title="first.png"]').click();
  await loaded(page,'first.png');
  // Wait for the deliberately late decode, not an arbitrary UI readiness wait.
  await page.waitForTimeout(400);
  await expect(page.locator('.thumb.active')).toHaveAttribute('title','first.png');
});
