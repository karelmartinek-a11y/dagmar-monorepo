import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';

// A synthetic opaque frame tests transport only. Real PDF/ZIP contents are
// qualified separately through the original routers in the CML repository.
const origin='https://attendance.example.test',prefix='/sections/dochazka/';
const source=await readFile(new URL('../../app/web_ui/api.js',import.meta.url));
const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.from(Array.from({length:8192},(_,i)=>i%256))]);
const zip=Buffer.concat([Buffer.from([80,75,3,4]),Buffer.from(Array.from({length:8192},(_,i)=>(255-i)%256))]);
const failures=[];
for(const name of(process.env.CML_BROWSER_ENGINES??'chromium').split(',')){
 assert(['chromium','webkit'].includes(name));const browser=await({chromium,webkit}[name]).launch();
 try{for(const scenario of['pdf','zip','retry','invalid']){
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(5000);let requests=0;
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'content-type'};
   if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   if(url.pathname==='/host'){
    await route.fulfill({contentType:'text/html',body:`<!doctype html><iframe sandbox="allow-scripts" src="${prefix}"></iframe><script>globalThis.received=[];globalThis.accept=true;addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.source!==f.contentWindow||e.origin!=='null'||e.data?.type!=='CML_SECTION_DOWNLOAD')return;received.push(e.data);f.contentWindow.postMessage({type:'CML_SECTION_DOWNLOAD_RESULT',prefix:'${prefix}',requestId:e.data.requestId,accepted:accept},'*');});</script>`});return;
   }
   if(url.pathname===prefix){
    const id=scenario==='zip'?'attendance-csv-zip':'attendance-plan-pdf';
    await route.fulfill({headers,contentType:'text/html',body:`<!doctype html><div id="operation-status"></div><button id="start">Export</button><script type="module">import{download}from'./api.js';globalThis.finished=0;document.querySelector('#start').onclick=async()=>{try{await download('api/export',{method:'POST',body:{year:2026,month:10},exportId:'${id}'});finished++;}catch(e){const host=document.querySelector('#operation-status');host.replaceChildren();const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=e.message;host.append(p);}};</script>`});return;
   }
   if(url.pathname===prefix+'api.js'){await route.fulfill({headers,contentType:'text/javascript',body:source});return;}
   assert.equal(url.pathname,prefix+'api/export');assert.equal(request.method(),'POST');assert.deepEqual(request.postDataJSON(),{year:2026,month:10});requests++;
   await route.fulfill({headers,contentType:scenario==='zip'?'application/zip':'application/pdf',body:scenario==='invalid'?Buffer.from('not a PDF'):scenario==='zip'?zip:pdf});
  });
  try{
   await page.goto(origin+'/host');const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Export',exact:true}).waitFor();
   if(scenario==='retry')await page.evaluate(()=>{globalThis.accept=false;});
   await frame.getByRole('button',{name:'Export',exact:true}).click();
   if(scenario==='invalid'){await expect(frame.getByRole('alert')).toContainText('platný soubor');assert.equal(await page.evaluate(()=>globalThis.received.length),0);}
   else{
    if(scenario==='retry'){await expect(frame.getByRole('alert')).toContainText('Soubor je připravený.');await page.evaluate(()=>{globalThis.accept=true;});await frame.getByRole('button',{name:'Export',exact:true}).click();await expect(frame.getByRole('alert')).toHaveCount(0);}
    const native=page.frames().find(frame=>frame.url().endsWith(prefix));await native.waitForFunction(()=>globalThis.finished===1);
    const received=await page.evaluate(()=>globalThis.received.at(-1));assert.equal(received.prefix,prefix);assert.equal(received.id,scenario==='zip'?'attendance-csv-zip':'attendance-plan-pdf');assert.deepEqual(Buffer.from(received.base64,'base64'),scenario==='zip'?zip:pdf);
   }
   assert.equal(requests,1,'A new gesture must reuse the original file rather than repeat POST');console.log(`PASS ${name} ${scenario}`);
  }catch(error){failures.push(`${name} ${scenario}: ${error.message}`);console.error(`FAIL ${name} ${scenario}: ${error.message}`);}finally{await context.close();}
 }}finally{await browser.close();}
}
assert.deepEqual(failures,[]);
