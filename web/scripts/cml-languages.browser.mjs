import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign,createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=process.env.CML_PRINT_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'cml-print-'));await mkdir(out,{recursive:true});
const {privateKey,publicKey}=generateKeyPairSync('ed25519');await writeFile(out+'/public.json',JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'cml-web-1'}]}));
const port=20000+Math.floor(Math.random()*20000);
const prefix='/sections/dochazka/',origin='https://attendance.example.test';
const child=spawn(process.env.CML_TEST_PYTHON??'python3',['-m','uvicorn','cml_print_server:app','--app-dir',root+'/tests','--port',String(port),'--host','127.0.0.1','--no-access-log'],{cwd:root,env:{...process.env,PYTHONPATH:root+':'+root+'/tests',DAGMAR_DATABASE_URL:'sqlite://',CML_LOCAL_QUALIFICATION:'1',CML_WEB_JWKS_PATH:out+'/public.json',DAGMAR_SESSION_SECRET:'isolated-print-test-session-secret-0123456789'},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',d=>err+=d);
let browser;
try{
 let ready=false;for(let i=0;i<600;i++){if(child.exitCode!==null)throw Error(err);try{await fetch('http://127.0.0.1:'+port+'/api/v1/health');ready=true;break;}catch{/* Wait for the isolated local server. */}await new Promise(r=>setTimeout(r,100));}assert(ready,err);
 browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1440,height:900},locale:'cs-CZ'}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>console.log('PAGE_ERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE_ERROR',m.text());});
 await context.addInitScript(()=>{globalThis.__pending=0;const original=globalThis.fetch;globalThis.fetch=async(...args)=>{globalThis.__pending++;try{return await original(...args);}finally{globalThis.__pending--;}};});
 let dto,role='admin',forwarding=Promise.resolve();
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
  if(url.pathname.startsWith('/assets/')){try{const assetRoot=process.env.CML_SHARED_ASSETS;if(!assetRoot)throw Error('CML_SHARED_ASSETS required for visual evidence');const content=await readFile(join(assetRoot,url.pathname.slice('/assets/'.length)));await route.fulfill({body:content,contentType:url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.woff2')?'font/woff2':url.pathname.endsWith('.ttf')?'font/ttf':'text/css'});}catch{await route.fulfill({status:404});}return;}
  const path='/cml-web/'+url.pathname.slice(prefix.length)+url.search,body=req.postDataBuffer()??Buffer.alloc(0),now=Math.floor(Date.now()/1000);
  const claims={iss:'https://kajovocml.hcasc.cz',aud:'dochazka',sub:role==='admin'?'KRMAR78':'user:11111111-1111-4111-8111-111111111111',role,nativeId:role==='admin'?null:'1',sid:randomUUID(),epoch:1,iat:now,exp:now+10,jti:randomUUID(),method:req.method(),path,bodySha256:createHash('sha256').update(body).digest('hex'),csrf:'a'.repeat(43)};
  const raw=Buffer.from(JSON.stringify({typ:'cml-web+jwt',alg:'EdDSA',kid:'cml-web-1'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
  const response=forwarding.then(async()=>{const r=await fetch('http://127.0.0.1:'+port+path,{method:req.method(),headers:{Origin:'https://kajovocml.hcasc.cz','X-CML-Web-Prefix':prefix,'X-CML-Web-Assertion':raw+'.'+sign(null,Buffer.from(raw),privateKey).toString('base64url'),'X-CSRF-Token':'a'.repeat(43),'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method())?undefined:body});
  return {r,bytes:Buffer.from(await r.arrayBuffer())};});forwarding=response.catch(()=>{});
  const {r,bytes}=await response;if(!r.ok)console.log('HTTP_ERROR',path,r.status,bytes.toString().slice(0,200));if(r.ok&&(path.includes('admin/attendance/month')||path.includes('api/v1/attendance?')))dto=JSON.parse(bytes);await route.fulfill({status:r.status,contentType:r.headers.get('content-type')??'application/octet-stream',body:bytes});
 });
 await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
 const onlyViews=process.env.CML_LANGUAGE_VIEWS?.split(',');
 const captions={cs:'Moje docházka',en:'My attendance',sk:'Moja dochádzka',de:'Meine Zeiterfassung',hi:'मेरी उपस्थिति'};
 if(!onlyViews)for(role of ['admin','member'])for(const lang of (role==='admin'?['cs','en','sk','de']:['cs','en','sk','de','hi']))for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:width===768?1024:width===390?844:900});
  await page.goto(origin+prefix+'?view=attendance&lang='+lang);
  await page.locator('table tbody tr').first().waitFor();
  await page.evaluate(()=>globalThis.document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('lang'),lang);
  const expected=role==='member'?captions[lang]:{cs:'Docházkové listy',en:'Attendance sheets',sk:'Dochádzkové listy',de:'Stundenzettel'}[lang];
  assert.equal(await page.locator('h1').innerText(),expected);
  assert.equal(await page.locator('select[name=locale]').inputValue(),lang);
  assert.equal(await page.locator('select[name=locale] option').count(),role==='admin'?4:5);
  assert.equal(await page.locator('input.clock').count(),248);
  assert.equal(await page.locator('input.clock').first().inputValue(),'07:00');
  assert.equal(await page.locator('input.clock').nth(1).inputValue(),'09:00');
  assert(await page.locator('body').innerText().then(text=>text.includes('Testovací zaměstnanec s delším jménem')),'Personal names are preserved');
  const sheet=role==='admin'?dto.data[0]:dto;
  assert.equal(sheet.worked.total.hours,251.1);
  assert.equal(sheet.days[0].events[0].occurred_at.slice(11,16),'07:00');
  assert(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth),'No page overflow');
  await page.screenshot({path:out+'/'+role+'-'+lang+'-'+width+'.png',fullPage:true});
  console.log('PASS language',role,lang,width,'real data, personal name, time inputs and backend hours unchanged');
 }
 // Exercise each declared navigation view against the real signed backend.
 for(role of ['admin','member'])for(const lang of (role==='admin'?['cs','en','sk','de']:['cs','en','sk','de','hi'])){
  await page.goto(origin+prefix+'?view=attendance&lang='+lang);
  const manifest=await page.evaluate(async()=>await(await fetch('/sections/dochazka/ui-manifest.json')).json());
  for(const view of manifest.views.filter(v=>v.navigation!==false&&(!v.audienceRole||v.audienceRole===role)&&(!onlyViews||onlyViews.includes(v.id))))for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:width===768?1024:width===390?844:900});
   const target=new URL(view.path,origin);target.searchParams.set('lang',lang);
   await page.goto(target.href);await page.locator('#content h1').waitFor();await page.waitForFunction(()=>globalThis.__pending===0&&globalThis.document.querySelector('.native-language'));await page.evaluate(()=>globalThis.document.fonts.ready);
   assert.equal(await page.locator('html').getAttribute('lang'),lang);
   assert(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth),'No page overflow: '+view.id);
   assert.equal(await page.locator('h1').count(),1);
   await page.screenshot({path:out+'/'+role+'-'+lang+'-'+view.id+'-'+width+'.png',fullPage:true});
   console.log('PASS declared view',view.id,lang,width);
  }
 }
 await context.close();
}finally{if(err.includes('ERROR:'))console.error(err);if(browser)await browser.close();child.kill('SIGTERM');}
