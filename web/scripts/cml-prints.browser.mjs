import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';

// Only new CML UI assets and isolated responses. Every external request fails.
const root=new URL('../../app/web_ui/',import.meta.url),origin='https://attendance.example.test',prefix='/sections/dochazka/';
const metric=hours=>({hours});
const sheet=(id,task=false)=>({employment_id:id,user_name:'Test '+id,employment_label:'Test '+id+' · Úvazek',employment_title:'Úvazek '+id,employment_type:task?'TASK_SHIFT_BASED':'WORK_CONTRACT',is_active_in_month:true,display_metrics:task?[]:['total','night'],planned_hours:25.5,worked:{total:metric(12345.6),night:metric(3.7)},planned:{total:metric(25.5),night:metric(2.1)},status_metrics:{holiday:metric(8),sickness:metric(0),paragraph:metric(0)},days:[{date:'2026-10-01',events:Array.from({length:10},(_,i)=>({id:i+1,occurred_at:`2026-10-01T${String(6+i).padStart(2,'0')}:00:00+02:00`})),planned_arrival_time:'08:00',planned_departure_time:'16:00',planned_status:null,effective_status:null,worked:{total:metric(9.3),night:metric(1.2)},planned:{total:metric(8),night:metric(0)}}]});
const data=[sheet(1),sheet(2,true)];
const output=process.env.CML_PRINT_EVIDENCE_DIR; if(output)await mkdir(output,{recursive:true});
let cases=0;
for(const engine of(process.env.CML_BROWSER_ENGINES??'chromium').split(',')){
 assert(['chromium','webkit'].includes(engine));const browser=await({chromium,webkit}[engine]).launch();
 try{for(const width of[1440,768,390]){
  let admin=true;const context=await browser.newContext({viewport:{width,height:1000},locale:'cs-CZ'}),page=await context.newPage(),errors=[],requests=[];page.setDefaultTimeout(5000);page.on('console',m=>{if(m.type()==='error')console.error(m.text(),m.location());});page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.addInitScript(()=>{globalThis.printCalls=0;globalThis.print=()=>globalThis.printCalls++;});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);const path=url.pathname.slice(prefix.length);requests.push({path,method:request.method(),query:Object.fromEntries(url.searchParams)});
   if(['','app.js','printing.js','api.js','ui.js','ui.css'].includes(path)){const file=path||'index.html';await route.fulfill({body:await readFile(new URL(file,root)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});return;}
   if(url.pathname.startsWith('/assets/')){await route.fulfill({status:204});return;}
   if(path==='identity'){await route.fulfill({json:{admin}});return;}
   if(path==='api/v1/admin/attendance/month'){await route.fulfill({json:{data}});return;}
   if(path==='api/v1/admin/shift-plan'){await route.fulfill({json:{available_employments:data.map(row=>({id:row.employment_id,display_label:row.employment_label,is_active_in_month:true})),selected_employment_ids:[2]}});return;}
   if(path==='api/v1/admin/export'){assert.equal(request.method(),'GET');assert.notEqual(url.searchParams.has('bulk'),url.searchParams.has('employment_id'));await route.fulfill({contentType:url.searchParams.has('bulk')?'application/zip':'text/csv',body:url.searchParams.has('bulk')?Buffer.from([80,75,3,4,1]):Buffer.from('Datum;PRŮCHOD 1\n2026-10-01;06:00\n')});return;}
   throw Error('Unexpected request '+path);
  });
  try{
   await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));await page.goto(origin+prefix+'?view=prints');
   await expect(page.locator('input[name=employment]:checked')).toHaveCount(2);
   await page.getByRole('button',{name:'Zrušit výběr',exact:true}).click();await expect(page.getByRole('button',{name:'Otevřít náhled',exact:true})).toBeDisabled();
   await page.getByLabel('Varianta docházky').selectOption('summary');await expect(page.locator('input[name=employment]:checked')).toHaveCount(0);
   await page.getByRole('button',{name:'Vybrat všechny úvazky',exact:true}).click();await page.getByRole('button',{name:'Otevřít náhled',exact:true}).click();
   await expect(page.locator('.print-paper')).toHaveCount(2);await expect(page.locator('.print-paper').first()).toContainText('12 345,6 h');await expect(page.locator('.print-paper').first()).toContainText('3,7 h');await expect(page.locator('.print-paper').nth(1)).toContainText('25,5 h');assert.equal(await page.locator('.print-paper').nth(1).getByText('Odpracováno',{exact:true}).count(),0);
   if(output){await page.screenshot({path:`${output}/${engine}-${width}-summary.png`,fullPage:true});if(engine==='chromium'&&width===1440){await page.emulateMedia({media:'print'});await page.pdf({path:`${output}/summary-preview.pdf`,preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});}}
   await page.getByRole('button',{name:'Tisk / PDF',exact:true}).click();assert.equal(await page.evaluate(()=>globalThis.printCalls),1);await page.emulateMedia({media:'print'});await expect(page.locator('.print-toolbar')).toBeHidden();assert.equal(await page.locator('.print-paper').first().evaluate(n=>getComputedStyle(n).color),'rgb(23, 37, 54)');await page.emulateMedia({media:'screen'});
   await page.getByRole('button',{name:'Zpět na výběr',exact:true}).click();await page.getByLabel('Varianta docházky').selectOption('detail');await page.getByRole('button',{name:'Otevřít náhled',exact:true}).click();await expect(page.locator('.print-paper')).toHaveCount(2);await expect(page.locator('.print-paper').first()).toContainText('PRŮCHOD 10');await expect(page.locator('.print-paper').first()).toContainText('15:00');await expect(page.locator('.print-paper').first()).toContainText('9,3 h');
   if(output){await page.screenshot({path:`${output}/${engine}-${width}-detail.png`,fullPage:true});if(engine==='chromium'&&width===1440){await page.emulateMedia({media:'print'});await page.pdf({path:`${output}/detail-preview.pdf`,preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});}}
   await page.getByRole('button',{name:'Zpět na výběr',exact:true}).click();await page.getByLabel('Typ dokumentu').selectOption('shift_plan');await expect(page.getByLabel('Varianta docházky')).toHaveCount(0);await expect(page.locator('input[name=employment]:checked')).toHaveCount(2);await page.getByRole('button',{name:'Otevřít náhled',exact:true}).click();await expect(page.locator('.print-paper')).toHaveCount(2);await expect(page.locator('.print-paper').first()).toContainText('08:00');await expect(page.locator('.print-paper').first()).toContainText('16:00');await expect(page.locator('.print-paper').nth(1)).toContainText('Plánované hodiny: 25,5 h');
   if(output){await page.screenshot({path:`${output}/${engine}-${width}-plan.png`,fullPage:true});if(engine==='chromium'&&width===1440){await page.emulateMedia({media:'print'});await page.pdf({path:`${output}/plan-preview.pdf`,preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});}}
   await page.getByRole('button',{name:'Kompletní export',exact:true}).click();await expect(page.getByLabel('Rozsah exportu')).toBeVisible();await page.getByLabel('Rozsah exportu').selectOption('1');const csv=page.waitForEvent('download');await page.getByRole('button',{name:'Stáhnout CSV',exact:true}).click();assert.equal((await csv).suggestedFilename(),'dochazka.csv');await page.getByLabel('Rozsah exportu').selectOption('');const zip=page.waitForEvent('download');await page.getByRole('button',{name:'Stáhnout CSV / ZIP',exact:true}).click();assert.equal((await zip).suggestedFilename(),'dochazka.zip');
   const before=requests.length;await page.getByLabel('Měsíc exportu').fill('');await page.getByLabel('Měsíc exportu').blur();await expect(page.getByLabel('Měsíc exportu')).toHaveValue('2026-10');assert.equal(requests.length,before,'Invalid month sends no API request');await page.getByLabel('Měsíc exportu').fill('2026-11');await page.getByLabel('Měsíc exportu').blur();await expect(page.getByLabel('Měsíc exportu')).toHaveValue('2026-11');await expect(page.getByLabel('Rozsah exportu')).toHaveValue('');
   admin=false;const beforeMember=requests.filter(r=>r.path.startsWith('api/')).length;await page.goto(origin+prefix+'?view=prints');await expect(page.getByRole('alert')).toContainText('vyžaduje přístup správce');assert.equal(requests.filter(r=>r.path.startsWith('api/')).length,beforeMember);
   await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'),'Preview and selection never mutate plan, events or persistent selection');assert(!requests.some(r=>r.path.endsWith('/selection')));cases++;console.log(`PASS ${engine} ${width} selectors, summary, ten events, task hours, plan, CSV/ZIP, invalid month, print media`);
  }catch(e){console.error(JSON.stringify({errors,requests,body:await page.locator('body').innerText()}));throw e;}finally{await context.close();}
 }}finally{await browser.close();}
}
assert(cases);console.log(JSON.stringify({status:'PASS_ISOLATED_PRINT_UI',cases,syntheticOnly:true,fullPrintAcceptance:false}));
