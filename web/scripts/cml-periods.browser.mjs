import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium, webkit, expect} from '@playwright/test';

// Only the newly authored CML UI is loaded. All API responses and writes are
// isolated browser adapters; this runner cannot reach a production backend.
const root=new URL('../../app/web_ui/',import.meta.url);
const origin='https://attendance.example.test';
const prefix='/sections/dochazka/';
const failures=[];
const row=(label,date)=>({employment_id:1,display_label:label,user_name:label,
 employment_label:label,title:'Recepce',employment_type:'WORK_CONTRACT',
 is_own_employment:false,shift_plan_locked:false,planned_hours:8,display_metrics:['total'],
 summary:{planned_hours:8},days:[{date,arrival_time:'08:00',departure_time:'16:00',
 planned_arrival_time:'08:00',planned_departure_time:'16:00',
 status:null,planned_status:null,is_within_employment_period:true}]});
const dateOf=url=>`${url.searchParams.get('year')}-${url.searchParams.get('month').padStart(2,'0')}-01`;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

async function fixture(browser,width,view,handler,admin=false){
 const context=await browser.newContext({viewport:{width,height:900}});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(5000);
 page.on('pageerror',error=>errors.push(error.message));
 // A zero-delay task after response.json settles runs after the UI's awaiting
 // microtasks. It makes the released stale response assertion deterministic.
 await page.addInitScript(()=>{
  globalThis.cmlSettled=[];
  const fetch=globalThis.fetch;
  globalThis.fetch=async(...args)=>{
   const response=await fetch(...args),json=response.json.bind(response);
   response.json=async()=>{const value=await json();setTimeout(()=>globalThis.cmlSettled.push(String(args[0])),0);return value;};
   return response;
  };
 });
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  assert.equal(url.origin,origin,'No external or production network access');
  const path=url.pathname.slice(prefix.length);
  if(['','app.js','clock-editor.js','api.js','ui.js','ui.css','printing.js','admin-info.js'].includes(path)){
   const file=path||'index.html';
   await route.fulfill({body:await readFile(new URL(file,root)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});return;
  }
  if(url.pathname.startsWith('/assets/')){await route.fulfill({status:204});return;}
  if(path==='identity'){await route.fulfill({json:{admin}});return;}
  const data=await handler({path,url,request:route.request()});
  assert.notEqual(data,undefined,`Unhandled isolated API: ${path}`);
  await route.fulfill(data.httpStatus?{status:data.httpStatus,json:{detail:data.message}}:{json:data});
 });
 await page.goto(`${origin}${prefix}?view=${view}`);
 return {page,close:async()=>{assert.deepEqual(errors,[]);await context.close();}};
}

async function stalePeriod(browser,width,view,{switchGroup=false,switchEmployment=false,lateError=false}={}){
 const release=deferred(),started=deferred();let first=true,oldUrl;
 const f=await fixture(browser,width,view,async({path,url})=>{
  if(path==='api/v1/shift-plan/groups')return {groups:[{id:10,name:'Recepce'},{id:20,name:'Kuchyně'}]};
  if(path==='api/v1/attendance/employments')return [{id:1,label:'Recepce'},{id:2,label:'Výpomoc'}];
  if(['api/v1/shift-plan/groups/10','api/v1/shift-plan/groups/20','api/v1/attendance'].includes(path)){
   const old=first;first=false;
   if(old){oldUrl=url.href;started.resolve();await release.promise;if(lateError)return {httpStatus:403,message:'Staré odmítnutí'};}
   const data=row(old?'Staré období':'Nové období',dateOf(url));
   return view==='group-plan'?{rows:[data]}:data;
  }
 });
 try{
  await started.promise;
  if(switchGroup)await f.page.getByRole('combobox',{name:'Skupina'}).selectOption('20');
  else if(switchEmployment)await f.page.getByRole('combobox',{name:'Úvazek'}).selectOption('2');
  else await f.page.getByRole('button',{name:'›',exact:true}).click();
  await expect(f.page.getByText('Nové období',{exact:true})).toBeVisible();
  release.resolve();
  await f.page.waitForFunction(url=>globalThis.cmlSettled.includes(url),oldUrl);
  await expect(f.page.getByText('Staré období',{exact:true})).toHaveCount(0);
  await expect(f.page.getByRole('alert')).toHaveCount(0);
  await expect(f.page.locator('input.clock')).toHaveCount(2);
 }finally{release.resolve();await f.close();}
}

async function groupFallback(browser,width){
 let period,invalidGroup=false;
 const f=await fixture(browser,width,'group-plan',({path,url})=>{
  if(path==='api/v1/shift-plan/groups'){
   const date=dateOf(url);period??=date;
   return {groups:[{id:date===period?10:20,name:date===period?'Původní skupina':'Nová skupina'}]};
  }
  if(path.startsWith('api/v1/shift-plan/groups/')){
   const changed=dateOf(url)!==period;
   if(changed&&!path.endsWith('/20'))invalidGroup=true;
   return {rows:[row(changed?'Nový výběr':'Původní výběr',dateOf(url))]};
  }
 });
 try{
  await expect(f.page.getByText('Původní výběr',{exact:true})).toBeVisible();
  await f.page.getByRole('button',{name:'›',exact:true}).click();
  await expect(f.page.getByText('Nový výběr',{exact:true})).toBeVisible();
  await expect(f.page.getByRole('combobox',{name:'Skupina'})).toHaveValue('20');
  assert.equal(invalidGroup,false,'The request must use an available group, matching the selector');
 }finally{await f.close();}
}

async function emptySelection(browser,width){
 const saved=[];
 const f=await fixture(browser,width,'plan',({path,request})=>{
  if(path==='api/v1/admin/shift-plan')return {rows:[],available_employments:[{id:1,display_label:'Recepce'}],selected_employment_ids:[]};
  if(path==='api/v1/admin/shift-plan/selection'){
   assert.equal(request.method(),'PUT');saved.push(request.postDataJSON());return {};
  }
 },true);
 try{
  await f.page.getByRole('button',{name:'Vybrat úvazky'}).click();
  await expect(f.page.getByRole('checkbox')).not.toBeChecked();
  await f.page.getByRole('button',{name:'Použít výběr'}).click();
  await expect(f.page.getByRole('dialog')).not.toBeVisible();
  assert.equal(saved.length,1);assert.deepEqual(saved[0].employment_ids,[]);
  await f.page.getByRole('button',{name:'Vybrat úvazky'}).click();
  await expect(f.page.getByRole('checkbox')).not.toBeChecked();
 }finally{await f.close();}
}

async function clockSaves(browser,width,{concurrent=false,navigate=false,tab=false}={}){
 const releases=[deferred(),deferred()],started=[deferred(),deferred()],saved=new Map();let dates;
 const f=await fixture(browser,width,'plan',async({path,url,request})=>{
  if(path==='api/v1/attendance/employments')return [{id:1,label:'Recepce'}];
  if(path==='api/v1/attendance'){
   dates=[dateOf(url),dateOf(url).replace(/01$/,'02')];
   const data=row('Recepce',dates[0]);data.days=dates.map(date=>({...row('',date).days[0],planned_arrival_time:saved.get(date)??'08:00'}));return data;
  }
  if(path==='api/v1/shift-plan'){
   assert.equal(request.method(),'PUT');const data=request.postDataJSON(),index=dates.indexOf(data.date);assert.ok(index>=0);
   started[index].resolve();await releases[index].promise;saved.set(data.date,data.arrival_time);return {};
  }
 });
 try{
  await expect(f.page.locator('input.clock')).toHaveCount(4);
  const arrival=index=>f.page.getByRole('textbox',{name:dates[index]+' arrival_time úvazek 1',exact:true});
  await arrival(0).fill('08:10');await arrival(0).press(tab?'Tab':'Enter');await started[0].promise;
  await expect(arrival(0)).toHaveAttribute('readonly','');
  await expect(arrival(1)).not.toHaveAttribute('readonly','');
  if(navigate){
   const oldDate=dates[0];await f.page.getByRole('button',{name:'›',exact:true}).click();
   await expect(f.page.locator('input.clock')).toHaveCount(4);assert.equal(dates[0],oldDate,'Navigation waits for save and canonical read');
   releases[0].resolve();await expect.poll(()=>dates[0]).not.toBe(oldDate);const currentDate=dates[0];
   await f.page.waitForFunction(url=>globalThis.cmlSettled.includes(url),origin+prefix+'api/v1/shift-plan');
   await expect(f.page.getByRole('textbox',{name:oldDate+' arrival_time úvazek 1',exact:true})).toHaveCount(0);
   await expect(f.page.getByRole('textbox',{name:currentDate+' arrival_time úvazek 1',exact:true})).toHaveValue('08:00');
   await expect(f.page.locator('input.clock')).toHaveCount(4);assert.equal(saved.size,1);return;
  }
  if(concurrent){await arrival(1).fill('08:20');await arrival(1).press('Enter');await started[1].promise;}
  releases[0].resolve();await expect(arrival(0)).toHaveValue('08:10');
  if(concurrent){
   // The first canonical read finishes while the second day's save is pending.
   await expect(arrival(1)).toHaveValue('08:00');
   await expect(arrival(1)).toHaveAttribute('readonly','');
   releases[1].resolve();await expect(arrival(1)).toHaveValue('08:20');
   await expect(arrival(1)).not.toHaveAttribute('readonly','');
  }else{
   await expect(arrival(0)).not.toHaveAttribute('readonly','');
   await expect(tab?f.page.getByRole('textbox',{name:dates[0]+' departure_time úvazek 1',exact:true}):arrival(0)).toBeFocused();
  }
  assert.equal(saved.size,concurrent?2:1);
 }finally{releases.forEach(r=>r.resolve());await f.close();}
}

async function planStatus(browser,width,{admin=false,group=false,clear=false,cancel=false,rejected=false}={}){
 const writes=[];let date,dialogs=0;
 const f=await fixture(browser,width,group?'group-plan':'plan',({path,url,request})=>{
  if(request.method()==='PUT'){writes.push({path,body:request.postDataJSON()});return rejected?{httpStatus:409,message:'Změna vyžaduje vyřešení konfliktu'}:{};}
  if(path==='api/v1/shift-plan/groups')return {groups:[{id:10,name:'Recepce'}]};
  if(path==='api/v1/attendance/employments')return [{id:1,label:'Recepce'}];
  date=dateOf(url);const data=row('Recepce',date);data.is_own_employment=true;
  data.days[0].arrival_time=data.days[0].departure_time=null;
  data.days[0].planned_arrival_time=data.days[0].planned_departure_time=null;
  if(path==='api/v1/admin/shift-plan')return {rows:[data],available_employments:[],selected_employment_ids:[1]};
  if(path==='api/v1/shift-plan/groups/10')return {rows:[data]};
  if(path==='api/v1/attendance')return data;
 },admin);
 f.page.on('dialog',dialog=>{dialogs++;return cancel?dialog.dismiss():dialog.accept();});
 try{
  await f.page.locator('table tbody button').first().click();
  if(clear){await expect(f.page.getByRole('button',{name:'Zrušit celodenní stav',exact:true})).toBeDisabled();assert.equal(writes.length,0);return;}
  await f.page.getByRole('button',{name:'Volno',exact:true}).click();
  assert.equal(dialogs,1);
  if(cancel){await expect(f.page.getByRole('dialog')).toBeVisible();assert.equal(writes.length,0);return;}
  if(rejected){await expect(f.page.getByRole('alert')).toContainText('Změna vyžaduje');await expect(f.page.getByRole('button',{name:'Volno',exact:true})).toBeEnabled();}
  else await expect(f.page.getByRole('dialog')).not.toBeVisible();
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0],{path:admin?'api/v1/admin/shift-plan':'api/v1/shift-plan',body:{employment_id:1,date,arrival_time:null,departure_time:null,status:'OFF'}});
 }finally{await f.close();}
}

async function adminLock(browser,width,{rejected=false,readFailure=false}={}){
 let locked=false;const writes=[];
 const f=await fixture(browser,width,'plan',({path,url,request})=>{
  if(path==='api/v1/admin/shift-plan'&&readFailure&&writes.length)return {httpStatus:503,message:'Readback unavailable'};
  if(path==='api/v1/admin/shift-plan')return {rows:[{...row('Recepce',dateOf(url)),shift_plan_locked:locked}],available_employments:[],selected_employment_ids:[1]};
  if(path==='api/v1/admin/locks'){
   const body=request.postDataJSON();writes.push(body);if(rejected)return {httpStatus:409,message:'Plán nelze uzamknout'};locked=body.locked;return {ok:true};
  }
 },true);
 try{
  await f.page.getByRole('button',{name:'Zamknout plán',exact:true}).click();
  if(readFailure){await expect(f.page.getByRole('alert')).toContainText('Změna zámku byla přijata');await expect(f.page.locator('input.clock').first()).toHaveAttribute('readonly','');await expect(f.page.getByRole('button',{name:'Zamknout plán',exact:true})).toBeDisabled();assert.equal(writes.length,1);return;}
  if(rejected){await expect(f.page.getByRole('alert')).toContainText('Plán nelze uzamknout');await expect(f.page.getByRole('button',{name:'Zamknout plán',exact:true})).toBeEnabled();assert.equal(writes.length,1);return;}
  await expect(f.page.getByRole('button',{name:'Odemknout plán',exact:true})).toBeVisible();
  await expect(f.page.locator('input.clock').first()).toHaveAttribute('readonly','');
  assert.equal(writes.length,1);assert.equal(writes[0].lock_type,'shift_plan');assert.deepEqual(writes[0].employment_ids,[1]);
  await f.page.getByRole('button',{name:'Odemknout plán',exact:true}).click();
  await expect(f.page.getByRole('button',{name:'Zamknout plán',exact:true})).toBeVisible();
  await expect(f.page.locator('input.clock').first()).not.toHaveAttribute('readonly','');
 }finally{await f.close();}
}

async function ownEmployment(browser,width){
 const requested=[];
 const f=await fixture(browser,width,'plan',({path,url})=>{
  if(path==='api/v1/attendance/employments')return [{id:1,label:'Recepce'},{id:2,label:'Výpomoc'}];
  if(path==='api/v1/attendance'){
   const id=+url.searchParams.get('employment_id');requested.push(id);return {...row(id===1?'První úvazek':'Druhý úvazek',dateOf(url)),employment_id:id};
  }
 });
 try{
  await expect(f.page.getByRole('heading',{name:'První úvazek',exact:true})).toBeVisible();
  await f.page.getByRole('combobox',{name:'Úvazek'}).selectOption('2');
  await expect(f.page.getByRole('heading',{name:'Druhý úvazek',exact:true})).toBeVisible();
  await expect(f.page.locator('input.clock').first()).toHaveAttribute('data-day-key',/2:/);
  assert.deepEqual(requested,[1,2]);
 }finally{await f.close();}
}

async function planMetrics(browser,width,{task=false}={}){
 const f=await fixture(browser,width,'plan',({path,url})=>{
  if(path==='api/v1/admin/shift-plan'){
   const data=row('Recepce',dateOf(url));data.display_metrics=task?[]:['total','night'];
   data.employment_type=task?'TASK_SHIFT_BASED':'WORK_CONTRACT';
   data.days[0].planned_hours=7.3;data.days[0].planned={night:{hours:2.4}};
   data.summary={planned_hours:33.7,planned:{night:{hours:10.2}}};
   return {rows:[data],available_employments:[],selected_employment_ids:[1]};
  }
 },true);
 try{
  await expect(f.page.getByText('Měsíční součet: 33,7 h',{exact:false})).toBeVisible();
  if(task){await expect(f.page.getByRole('columnheader')).toHaveCount(4);}
  else{
   await expect(f.page.getByRole('columnheader',{name:'Plán (h)',exact:true})).toBeVisible();
   await expect(f.page.getByRole('cell',{name:'7,3 h',exact:true})).toBeVisible();
   await expect(f.page.getByRole('cell',{name:'2,4 h',exact:true})).toBeVisible();
   await expect(f.page.getByText('Noc 10,2 h',{exact:true})).toBeVisible();
  }
 }finally{await f.close();}
}

async function inheritedStatus(browser,width){
 const f=await fixture(browser,width,'plan',({path,url})=>{
  if(path==='api/v1/admin/shift-plan'){
   const data=row('Recepce',dateOf(url));data.days[0].effective_status='SICKNESS';
   return {rows:[data],available_employments:[],selected_employment_ids:[1]};
  }
 },true);
 try{
  await expect(f.page.getByRole('cell',{name:'Nemoc',exact:true})).toHaveCount(2);
  await expect(f.page.locator('input.clock')).toHaveCount(0);
  await expect(f.page.locator('table tbody button')).toHaveCount(0);
 }finally{await f.close();}
}

async function visibleMonthlyMetrics(browser,width){
 const metrics=['total','afternoon','night','weekend','public_holiday'];
 const values=Object.fromEntries(metrics.map(key=>[key,{hours:12345.6}]));
 const f=await fixture(browser,width,'attendance',({path,url,request})=>{
  assert.equal(request.method(),'GET','Metric visibility must not write data');
  if(path==='api/v1/admin/attendance/month')return {data:[{employment_id:1,employment_label:'Syntetický úvazek',attendance_locked:true,display_metrics:metrics,worked:values,days:[{date:dateOf(url),events:[],worked:values,is_within_employment_period:true}]}]};
 },true);
 try{
  await expect(f.page.locator('.monthly-total > span')).toHaveCount(metrics.length);
  for(const targetWidth of width===390?[390,320]:[width]){
   await f.page.setViewportSize({width:targetWidth,height:900});
   assert(await f.page.locator('.monthly-total > span').evaluateAll(nodes=>nodes.every(node=>{const box=node.getBoundingClientRect(),panel=node.closest('.panel').getBoundingClientRect();return box.left>=panel.left&&box.right<=panel.right;})),'Every canonical monthly metric must fit inside the visible panel');
  }
 }finally{await f.close();}
}

for(const engine of (process.env.CML_BROWSER_ENGINES??'chromium').split(',')){
 assert.ok(['chromium','webkit'].includes(engine));
 const browser=await ({chromium,webkit}[engine]).launch();
 try{for(const width of [1440,390])for(const [name,test] of [
  ['group-period',b=>stalePeriod(b,width,'group-plan')],
  ['own-period',b=>stalePeriod(b,width,'plan')],
  ['own-employment-selection',b=>ownEmployment(b,width)],
  ['own-employment-race',b=>stalePeriod(b,width,'plan',{switchEmployment:true})],
  ['group-selection-race',b=>stalePeriod(b,width,'group-plan',{switchGroup:true})],
  ['stale-error',b=>stalePeriod(b,width,'group-plan',{lateError:true})],
  ['available-group',b=>groupFallback(b,width)],
  ['concurrent-day-saves',b=>clockSaves(b,width,{concurrent:true})],
  ['save-keeps-focus',b=>clockSaves(b,width)],
  ['save-tab-after-readback',b=>clockSaves(b,width,{tab:true})],
  ['save-after-month-navigation',b=>clockSaves(b,width,{navigate:true})],
  ['admin-plan-status-route',b=>planStatus(b,width,{admin:true})],
  ['own-plan-status-route',b=>planStatus(b,width)],
  ['group-plan-status-route',b=>planStatus(b,width,{group:true})],
  ['admin-plan-lock',b=>adminLock(b,width)],
  ['admin-plan-lock-error',b=>adminLock(b,width,{rejected:true})],
  ['admin-plan-lock-readback-error',b=>adminLock(b,width,{readFailure:true})],
  ['backend-plan-metrics',b=>planMetrics(b,width)],
  ['task-plan-monthly-hours',b=>planMetrics(b,width,{task:true})],
  ['inherited-attendance-status',b=>inheritedStatus(b,width)],
  ['plan-clear-disabled-without-status',b=>planStatus(b,width,{admin:true,clear:true})],
  ['plan-status-cancel-no-write',b=>planStatus(b,width,{admin:true,cancel:true})],
  ['plan-status-conflict-not-retried',b=>planStatus(b,width,{admin:true,rejected:true})],
  ['empty-selection',b=>emptySelection(b,width)],
  ['canonical-monthly-metrics-visible',b=>visibleMonthlyMetrics(b,width)]]){
  try{await test(browser);console.log(`PASS ${engine} ${width} ${name}`);}
  catch(error){failures.push(`${engine} ${width} ${name}: ${error.message}`);console.error(`FAIL ${engine} ${width} ${name}: ${error.message}`);}
 }}finally{await browser.close();}
}
assert.deepEqual(failures,[]);
