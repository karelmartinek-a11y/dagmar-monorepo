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
 let dto,forwarding=Promise.resolve();
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);
  if(url.pathname.startsWith('/assets/')){try{const content=url.pathname.endsWith('.ttf')?await readFile(root+'/web/node_modules/@fontsource/montserrat/files/montserrat-latin-400-normal.woff2'):'';await route.fulfill({body:content});}catch{await route.fulfill({status:404});}return;}
  const path='/cml-web/'+url.pathname.slice(prefix.length)+url.search,body=req.postDataBuffer()??Buffer.alloc(0),now=Math.floor(Date.now()/1000);
  const claims={iss:'https://kajovocml.hcasc.cz',aud:'dochazka',sub:'KRMAR78',role:'admin',nativeId:null,sid:randomUUID(),epoch:1,iat:now,exp:now+10,jti:randomUUID(),method:req.method(),path,bodySha256:createHash('sha256').update(body).digest('hex'),csrf:'a'.repeat(43)};
  const raw=Buffer.from(JSON.stringify({typ:'cml-web+jwt',alg:'EdDSA',kid:'cml-web-1'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
  const response=forwarding.then(async()=>{const r=await fetch('http://127.0.0.1:'+port+path,{method:req.method(),headers:{Origin:'https://kajovocml.hcasc.cz','X-CML-Web-Prefix':prefix,'X-CML-Web-Assertion':raw+'.'+sign(null,Buffer.from(raw),privateKey).toString('base64url'),'X-CSRF-Token':'a'.repeat(43),'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method())?undefined:body});
  return {r,bytes:Buffer.from(await r.arrayBuffer())};});forwarding=response.catch(()=>{});
  const {r,bytes}=await response;if(!r.ok)console.log('HTTP_ERROR',path,r.status,bytes.toString().slice(0,200));if(r.ok&&path.includes('admin/attendance/month'))dto=JSON.parse(bytes);await route.fulfill({status:r.status,contentType:r.headers.get('content-type')??'application/octet-stream',body:bytes});
 });
 await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
 const captions={cs:['Typ dokumentu','Varianta docházky','Otevřít náhled','Tisk / PDF','Stáhnout PDF'],en:['Document type','Attendance variant','Open preview','Print / PDF','Download PDF'],sk:['Typ dokumentu','Variant dochádzky','Otvoriť náhľad','Tlač / PDF','Stiahnuť PDF'],de:['Dokumenttyp','Berichtsart','Vorschau öffnen','Drucken / PDF','PDF herunterladen']};
 for(const lang of ['cs','en','sk','de']){
 const labels=captions[lang];
 for(const width of [1440,768,390]){
 await page.setViewportSize({width,height:width===768?1024:width===390?844:900});
 for(const [period,days] of (width===1440?[['2026-10',31],['2026-02',28],['2028-02',29],['2026-06',30]]:[['2026-10',31]])){
 await page.clock.setFixedTime(new Date(period+'-15T12:00:00Z'));
 for(const kind of ['detail','summary','plan']){
  await page.goto(origin+prefix+'?view=prints&lang='+lang);try{await page.locator('input[name=employment]').first().waitFor();}catch(e){console.log('BODY',await page.locator('body').innerText());throw e;}
  if(kind==='plan')await page.getByLabel(labels[0]).selectOption('shift_plan');else await page.getByLabel(labels[1]).selectOption(kind);
  await page.getByRole('button',{name:labels[2],exact:true}).click();await page.locator('.print-paper').waitFor();await page.getByRole('button',{name:labels[3],exact:true}).waitFor();
  assert.equal(dto.data[0].worked.total.hours,days*81/10);assert.equal(dto.data[0].planned_hours,days*81/10);assert.equal(dto.data[0].days.length,days);
  assert.equal(await page.getByRole('button',{name:labels[3],exact:true}).isEnabled(),true);
  if(kind!=='summary'){assert.match(await page.locator('.print-total').innerText(),new RegExp(new Intl.NumberFormat(lang,{minimumFractionDigits:1,maximumFractionDigits:1}).format(days*81/10).replace('.', String.fromCharCode(92)+'.')));}
  if(kind==='plan'&&width===1440){const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:labels[4],exact:true}).click();const download=await downloadEvent;await download.saveAs(out+'/'+lang+'-'+period+'-native-plan.pdf');assert.equal(await download.failure(),null);}
  await page.screenshot({path:out+'/'+lang+'-'+period+'-'+width+'-'+kind+'-screen.png',fullPage:true});
  if(width===390&&kind!=='summary'){
   const region=page.locator('.print-paper .table-scroll');
   assert(await region.evaluate(n=>{n.scrollLeft=n.scrollWidth;const last=n.querySelector('thead th:last-child').getBoundingClientRect(),box=n.getBoundingClientRect();return n.scrollLeft>0&&last.right<=box.right+1&&last.left>=box.left;}),'Rightmost metric remains reachable on mobile');
   await page.screenshot({path:out+'/'+lang+'-'+period+'-'+width+'-'+kind+'-right-screen.png',fullPage:true});
   await region.evaluate(n=>{n.scrollLeft=0;});
  }
  assert(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth),'The page itself must not overflow');
  await page.emulateMedia({media:'print'});const pdf=await page.pdf({path:out+'/'+lang+'-'+period+'-'+width+'-'+kind+'.pdf',preferCSSPageSize:true,printBackground:true});
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)??[]).length,1,kind+' must fit one A4 page at viewport '+width);
  await page.screenshot({path:out+'/'+lang+'-'+period+'-'+width+'-'+kind+'-print.png',fullPage:true});
  console.log(JSON.stringify({lang,period,width,kind,monthlyWorked:dto.data[0].worked.total.hours,monthlyPlan:dto.data[0].planned_hours,summaryText:await page.locator('.print-summary').allTextContents()}));await page.emulateMedia({media:'screen'});
 }
 }
 }
 }
 await writeFile(out+'/dto.json',JSON.stringify(dto));await context.close();console.log('PASS full-month backend print: 28/29/30/31 days, four languages, three viewports, native plan PDF, backend totals');
}finally{if(err.includes('ERROR:'))console.error(err);if(browser)await browser.close();child.kill('SIGTERM');}
