import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';

const root=new URL('../../app/web_ui/',import.meta.url),origin='https://attendance.example.test',prefix='/sections/dochazka/';
const output=process.env.CML_INFO_EVIDENCE_DIR;if(output)await mkdir(output,{recursive:true});
const engines=(process.env.CML_BROWSER_ENGINES??'chromium').split(',');let cases=0;
for(const name of engines){
 assert(['chromium','webkit'].includes(name));const browser=await({chromium,webkit}[name]).launch();
 try{for(const width of[1440,768,390]){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'cs-CZ'}),page=await context.newPage(),errors=[],requests=[];let partial=false,admin=true,healthy=true,holdUser=false,releaseUser;const userGate=new Promise(resolve=>releaseUser=resolve);page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{globalThis.infoSettled=[];const original=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await original(...args),json=response.json.bind(response);response.json=async()=>{const value=await json();setTimeout(()=>globalThis.infoSettled.push(String(args[0])),0);return value;};return response;};});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);const path=url.pathname.slice(prefix.length);requests.push(path);assert.equal(req.method(),'GET');
   if(['','app.js','admin-info.js','printing.js','api.js','ui.js','ui.css'].includes(path)){const file=path||'index.html';await route.fulfill({body:await readFile(new URL(file,root)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});return;}
   if(url.pathname.startsWith('/assets/')){await route.fulfill({status:204});return;}
   if(path==='identity'){await route.fulfill({json:{admin}});return;}
   if(path==='api/v1/admin/users'){const failed=partial;if(holdUser)await userGate;await route.fulfill(failed?{status:403,json:{detail:'Přehled účtů není povolen.'}}:{json:{users:[{is_active:true},{is_active:false}]}});return;}
   if(path==='api/v1/admin/integrations/clients'){await route.fulfill({json:[{status:'ACTIVE'},{status:'DISABLED'},{status:'EXPIRED'}]});return;}
   if(path==='api/version'){await route.fulfill({json:{backend_deploy_tag:'isolated-ui',environment:'isolated-qualification'}});return;}
   if(path==='api/v1/health'){await route.fulfill(healthy?{json:{ok:true}}:{status:503,json:{detail:'Nedostupné'}});return;}
   if(path==='api/v1/admin/shift-plan'){await route.fulfill({json:{rows:[],available_employments:[],selected_employment_ids:[]}});return;}
   throw Error('Unexpected API '+path);
  });
  try{
   await page.goto(origin+prefix+'?view=overview');await expect(page.locator('[data-stat=users] .admin-stat-value')).toHaveText('2');await expect(page.locator('[data-stat=users]')).toContainText('Aktivní uživatelé: 1');await expect(page.locator('[data-stat=clients] .admin-stat-value')).toHaveText('3');await expect(page.locator('[data-stat=clients]')).toContainText('Aktivní klienti: 1');await expect(page.locator('[data-stat=health] .admin-stat-value')).toHaveText('Ano');await expect(page.getByText('isolated-ui',{exact:true})).toBeVisible();
   if(output)await page.screenshot({path:`${output}/${name}-${width}-overview.png`,fullPage:true});
   partial=true;healthy=false;await page.getByRole('button',{name:'Obnovit přehled',exact:true}).click();await expect(page.locator('[data-stat=users] .admin-stat-value')).toHaveText('N/A');await expect(page.locator('[data-stat=health] .admin-stat-value')).toHaveText('Nedostupné');await expect(page.getByText('Část dat není dostupná',{exact:false})).toBeVisible();
   partial=false;healthy=true;await page.getByRole('button',{name:'Obnovit přehled',exact:true}).click();await expect(page.locator('[data-stat=users] .admin-stat-value')).toHaveText('2');await expect(page.getByText('Část dat není dostupná',{exact:false})).toHaveCount(0);
   partial=true;holdUser=true;await page.getByRole('button',{name:'Obnovit přehled',exact:true}).click();await page.getByRole('button',{name:'Plán služeb',exact:true}).click();releaseUser();await page.waitForFunction(()=>globalThis.infoSettled.filter(path=>path.includes('/admin/users')).length>=4);await expect(page.getByText('Část dat není dostupná',{exact:false})).toHaveCount(0);await expect(page.locator('#content')).toHaveAttribute('data-view','dochazka.admin.plan');await expect(page.getByText('Ve výběru není žádný úvazek.')).toBeVisible();
   await page.goto(origin+prefix+'?view=integrations');await expect(page.locator('#content')).toHaveAttribute('data-view','dochazka.admin.integrations');await expect(page.getByText('GET /openapi.json',{exact:true})).toBeVisible();await expect(page.getByText('Stažení OpenAPI vyžaduje',{exact:false})).toBeVisible();if(output)await page.screenshot({path:`${output}/${name}-${width}-integrations.png`,fullPage:true});
   admin=false;const count=requests.filter(p=>p.startsWith('api/')).length;await page.goto(origin+prefix+'?view=overview');await expect(page.getByRole('alert')).toContainText('vyžaduje přístup správce');assert.equal(requests.filter(p=>p.startsWith('api/')).length,count);
   await page.goto(origin+prefix+'?view=public-docs');await expect(page.locator('#content')).toHaveAttribute('data-view','dochazka.employee.public-docs');await expect(page.getByRole('button',{name:'Administrace',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Portál zaměstnance',exact:true})).toBeVisible();assert(!requests.some(p=>p.startsWith('api/v1/integration/')),'Documentation cannot borrow a web identity for protected integration routes');await page.waitForFunction(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth);assert.deepEqual(errors,[]);cases++;console.log(`PASS ${name} ${width} actual counts, partial data, liveness, refresh, links, docs and member guard`);
  }finally{await context.close();}
 }}finally{await browser.close();}
}
console.log(JSON.stringify({status:'PASS_ISOLATED_ADMIN_INFO',cases,readOnly:true,syntheticOnly:true}));
