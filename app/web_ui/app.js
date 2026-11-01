import {el,field,select,button,table,panel,notice,modal,formData,showError} from './ui.js';
import {api,view,download} from './api.js';
const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Prague'}));
const state={year:now.getFullYear(),month:now.getMonth()+1,employment:null,identity:null,view:new URLSearchParams(location.search).get('view')??'attendance',generation:0,pending:new Set(),uncertain:new Set()};
const metricNames={total:'Odpracováno',afternoon:'Odpoledne',night:'Noc',weekend:'Víkend',public_holiday:'Svátek',holiday:'Dovolená',sickness:'Nemoc',paragraph:'Paragraf'};
const employmentNames={WORK_CONTRACT:'Pracovní smlouva',DPP_DPC:'DPP / DPČ',TASK_SHIFT_BASED:'Úkolová / směnová odměna',EXTERNAL_HOURLY:'Externí hodinová fakturace'};
const statuses={HOLIDAY:'Dovolená',SICKNESS:'Nemoc',PARAGRAPH:'Paragraf',OFF:'Volno'};
const monthQuery=()=>new URLSearchParams({year:state.year,month:state.month});
const adminBase=()=>state.identity.admin?'api/v1/admin/':'api/v1/';
const hours=v=>v===null||v===undefined?'—':Number(v).toLocaleString('cs-CZ',{minimumFractionDigits:1,maximumFractionDigits:1})+' h';
function dayName(date){return new Date(date+'T12:00:00').toLocaleDateString('cs',{weekday:'long'});}
function monthBar(extra=[]){const label=el('strong',{},new Date(state.year,state.month-1,15).toLocaleDateString('cs',{month:'long',year:'numeric'}));return el('div',{class:'toolbar'},button('‹',()=>changeMonth(-1)),label,button('›',()=>changeMonth(1)),...extra,button('Obnovit',render));}
function changeMonth(delta){const next=new Date(state.year,state.month-1+delta,15);state.year=next.getFullYear();state.month=next.getMonth()+1;state.employment=null;state.uncertain.clear();render();}
function heading(id,title,desc){const main=view(id,title,desc);main.append(el('div',{id:'operation-status','aria-live':'polite'}));return main;}
function error(e){showError(document.querySelector('#operation-status')??document.querySelector('#content'),e);}
function metricBadges(sheet,kind){return el('div',{class:'metrics'},[...sheet.display_metrics,'holiday','sickness','paragraph'].map(key=>el('span',{class:'badge'},metricNames[key]+' '+hours((sheet[kind]?.[key]??sheet.status_metrics?.[key])?.hours))));}
function clock(value,{key,disabled,label,save}){
 const input=el('input',{class:'clock',type:'text',inputmode:'numeric',placeholder:'',value:value??'','aria-label':label,readOnly:disabled||state.pending.has(key)||state.uncertain.has(key),maxlength:5});
 let attempted=null;
 const normalized=v=>{if(!v.trim())return '';const m=v.trim().match(/^(\d{1,2})[:.,]?(\d{2})$/);if(!m||+m[1]>23||+m[2]>59)return null;return m[1].padStart(2,'0')+':'+m[2];};
 async function commit(next){const v=normalized(input.value);if(v===null){input.setAttribute('aria-invalid','true');return;}input.removeAttribute('aria-invalid');if(v===(value??'')||attempted===v||state.pending.has(key)||state.uncertain.has(key))return;attempted=v;state.pending.add(key);const peers=[...document.querySelectorAll('input[data-day-key]')].filter(n=>n.dataset.dayKey===key);peers.forEach(n=>n.readOnly=true);
 const selected={view:state.view,year:state.year,month:state.month,employment:state.employment,group:state.group};
 const stillCurrent=()=>Object.entries(selected).every(([k,value])=>state[k]===value);
 try{
  await save(v||null);if(!stillCurrent())return;
  const focus=document.activeElement===input?(next??label):document.activeElement?.dataset.clock;
  state.pending.delete(key);await render();
  if(focus&&stillCurrent())document.querySelector('[data-clock="'+CSS.escape(focus)+'"]')?.focus();
 }
 catch(e){if(e.uncertain)state.uncertain.add(key);input.setAttribute('aria-invalid','true');error(e);}
 finally{state.pending.delete(key);peers.forEach(n=>n.readOnly=disabled||state.uncertain.has(key));}
 }
 input.dataset.dayKey=key;input.dataset.clock=label;
 input.addEventListener('blur',()=>commit());input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Tab'){const v=normalized(input.value);if(v!==null&&v!==(value??'')&&attempted!==v){const all=[...document.querySelectorAll('input.clock')],next=all[all.indexOf(input)+(e.shiftKey?-1:1)]?.dataset.clock;e.preventDefault();commit(next);}}});return input;
}
async function attendance(){
 const generation=state.generation,isAdmin=state.identity.admin,id=isAdmin?'dochazka.admin.attendance':'dochazka.employee.attendance',main=heading(id,isAdmin?'Docházkové listy':'Moje docházka','Zkontrolujte skutečné průchody, hodinové metriky a zámek vybraného měsíce.');
 let sheets,employments;
 if(isAdmin){sheets=(await api('api/v1/admin/attendance/month?'+monthQuery())).data;employments=sheets.map(s=>({id:s.employment_id,label:s.employment_label}));}
 else{employments=await api('api/v1/attendance/employments?'+monthQuery());if(employments.length){if(!employments.some(e=>e.id===state.employment))state.employment=employments[0].id;sheets=[await api('api/v1/attendance?'+monthQuery()+'&employment_id='+state.employment)];}else sheets=[];}
 if(state.generation!==generation)return;
 const selector=select('Úvazek','employment',employments.map(e=>[String(e.id),e.label]),String(state.employment??''));selector.querySelector('select').addEventListener('change',e=>{state.employment=+e.target.value;render();});
 main.append(panel('Skutečná docházka',[monthBar([selector]),!sheets.length?notice('V tomto měsíci není dostupný žádný úvazek.'):null],'attendance'));
 if(isAdmin&&state.employment)sheets=sheets.filter(s=>s.employment_id===state.employment);
 for(const sheet of sheets){const count=Math.max(4,...sheet.days.map(d=>d.events.length)),cols=[...sheet.display_metrics];const tableRows=sheet.days.map(day=>{
  const key=sheet.employment_id+':'+day.date,locked=sheet.attendance_locked||!day.is_within_employment_period;
  const cells=Array.from({length:count},(_,index)=>{const event=day.events[index],v=event?new Date(event.occurred_at).toLocaleTimeString('cs',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'}):'';
   if(day.effective_status)return statuses[day.effective_status]??day.effective_status;
   return el('div',{},index===0&&day.planned_arrival_time?el('small',{},'plán '+day.planned_arrival_time):index===count-1&&day.planned_departure_time?el('small',{},'plán '+day.planned_departure_time):null,clock(v,{key,disabled:locked,label:day.date+' průchod '+(index+1)+' úvazek '+sheet.employment_id,save:async value=>{
    if(!value&&event){const suffix=event.deletion_partner_id?'?paired_event_id='+event.deletion_partner_id:'';await api(adminBase()+'attendance/events/'+event.id+suffix,{method:'DELETE'});}
    else if(value)await api(adminBase()+'attendance/events'+(event?'/'+event.id:''),{method:event?'PUT':'POST',body:{employment_id:sheet.employment_id,occurred_at:day.date+'T'+value+':00'}});
   }}));});
  const dateCell=button(new Date(day.date+'T12:00:00').toLocaleDateString('cs',{day:'numeric',month:'numeric'}),()=>dayMenu(sheet,day,'attendance'));dateCell.disabled=locked;
  return [dateCell,dayName(day.date),...cells,...cols.map(m=>hours(day.worked?.[m]?.hours))];
 });
 const body=el('div',{},el('div',{class:'sheet-heading'},el('strong',{},sheet.employment_label),el('span',{class:'badge'},sheet.attendance_locked?'Uzamčeno':'Otevřeno')),metricBadges(sheet,'worked'),table(['Datum','Den',...Array.from({length:count},(_,i)=>'Průchod '+(i+1)),...cols.map(k=>metricNames[k]+' (h)')],tableRows),el('div',{class:'monthly-total'},'Součet za měsíc: ',cols.map(k=>el('span',{},metricNames[k]+' '+hours(sheet.worked?.[k]?.hours)))),el('p',{},'Plánované časy slouží jako nápověda. Hodiny a jejich součty dodává backend.'));
 if(isAdmin)body.append(el('div',{class:'actions'},button(sheet.attendance_locked?'Odemknout měsíc':'Uzamknout měsíc',e=>lock(sheet,'ATTENDANCE',e.currentTarget)),button('Přidej pauzy',()=>confirm('Doplnit zákonné přestávky','Změní historické časy ve vybraném měsíci. Zápis se nevrací hromadným undo.',async()=>{await api('api/v1/admin/attendance/breaks',{method:'POST',body:{employment_id:sheet.employment_id,year:state.year,month:state.month,confirmed:true}});await render();}))));
 main.append(panel(sheet.employment_label,body,'attendance'));
 }
}
function confirm(title,text,task){modal(title,close=>el('div',{},notice(text,'warning'),button('Potvrdit',async e=>{e.currentTarget.disabled=true;try{await task();close();}catch(err){showError(document.querySelector('#dialog'),err);}},'danger')));}
function dayMenu(sheet,day,kind){modal('Nabídka dne '+day.date,close=>{
 const choices=kind==='plan'?{HOLIDAY:'Dovolená',OFF:'Volno'}:statuses;
 return el('div',{},el('div',{class:'actions'},Object.entries({...choices,'':'Zrušit celodenní stav'}).map(([status,label])=>{
  const action=button(label,async e=>{
   const control=e.currentTarget;
   if(kind==='plan'&&status&&!window.confirm('Nastavit '+label+' pro den '+day.date+'?'))return;
   control.disabled=true;
   try{
    const path=kind==='plan'?adminBase()+'shift-plan':(state.identity.admin?'api/v1/admin/day-status':'api/v1/attendance/day-status');
    const body={employment_id:sheet.employment_id,date:day.date,...(kind==='plan'?{arrival_time:null,departure_time:null}:{}),status:status||null};
    await api(path,{method:'PUT',body});close();await render();
   }catch(err){showError(document.querySelector('#dialog'),err);control.disabled=false;}
  });
  action.disabled=kind==='plan'&&!status&&!day.status;return action;
 })));
 });}
async function lock(sheet,type,control){
 if(control?.disabled)return;if(control)control.disabled=true;
 try{await api('api/v1/admin/locks',{method:'PUT',body:{lock_type:type.toLowerCase(),year:state.year,month:state.month,locked:!(type==='ATTENDANCE'?sheet.attendance_locked:sheet.shift_plan_locked),employment_ids:[sheet.employment_id]}});await render();}
 catch(e){error(e);}finally{if(control)control.disabled=false;}
}
async function plan(){
 const generation=state.generation,period=monthQuery(),isAdmin=state.identity.admin,groupView=state.view==='group-plan',main=heading(groupView?'dochazka.employee.group-plan':isAdmin?'dochazka.admin.plan':'dochazka.employee.plan',groupView?'Skupinový plán služeb':'Plán služeb','Upravujte plán přímo v časových buňkách. Uložení je potvrzeno až po načtení skutečného stavu.');
 let rows=[];
 if(isAdmin){const data=await api('api/v1/admin/shift-plan?'+period);if(generation!==state.generation)return;rows=data.rows;main.append(panel('Zobrazené úvazky',[monthBar(),button('Vybrat úvazky',()=>selection(data))],'group-plan'));}
 else if(groupView){
  const {groups}=await api('api/v1/shift-plan/groups?'+period);if(generation!==state.generation)return;
  if(!groups.some(g=>g.id===state.group))state.group=groups[0]?.id;
  const choose=select('Skupina','group',groups.map(g=>[String(g.id),g.name]),String(state.group??''));
  choose.querySelector('select').addEventListener('change',e=>{state.group=+e.target.value;render();});main.append(monthBar([choose]));
  if(state.group)rows=(await api('api/v1/shift-plan/groups/'+state.group+'?'+period)).rows;
 }
 else{
  const emps=await api('api/v1/attendance/employments?'+period);if(generation!==state.generation)return;
  if(!emps.some(e=>e.id===state.employment))state.employment=emps[0]?.id;
  const selector=select('Úvazek','employment',emps.map(e=>[String(e.id),e.label]),String(state.employment??''));
  selector.querySelector('select').addEventListener('change',e=>{state.employment=+e.target.value;render();});main.append(monthBar([selector]));
  if(state.employment){const s=await api('api/v1/attendance?'+period+'&employment_id='+state.employment);rows=[{...s,display_label:s.employment_label,summary:{planned_hours:s.planned_hours},days:s.days.map(d=>({...d,arrival_time:d.planned_arrival_time,departure_time:d.planned_departure_time,status:d.planned_status}))}];}
 }
 if(generation!==state.generation)return;
 if(!rows.length){main.append(notice('Ve výběru není žádný úvazek.'));return;}
 if(groupView){
  const days=rows[0].days;
  const matrix=table(['Úvazek',...days.map(d=>new Date(d.date+'T12:00:00').getDate()+'. '+dayName(d.date)), 'Měsíční součet'],rows.map(row=>{
   const identity=el('div',{class:'employment-identity'},row.user_name?el('strong',{},row.user_name):el('strong',{},row.display_label),row.title?el('span',{},row.title):null,row.employment_type?el('small',{},employmentNames[row.employment_type]??row.employment_type):null);
   return [identity,...row.days.map(day=>{
    const key=row.employment_id+':'+day.date,locked=row.shift_plan_locked||day.is_within_employment_period===false||(!isAdmin&&row.is_own_employment===false);
    const controls=['arrival_time','departure_time'].map(side=>clock(day[side],{key,disabled:locked||!!day.status,label:day.date+' '+side+' úvazek '+row.employment_id,save:async value=>{await api(adminBase()+'shift-plan',{method:'PUT',body:{employment_id:row.employment_id,date:day.date,arrival_time:side==='arrival_time'?value:day.arrival_time??null,departure_time:side==='departure_time'?value:day.departure_time??null,status:null}});}}));
    return el('div',{class:'plan-cell'},day.status?el('span',{},statuses[day.status]??day.status):controls,!locked?button('⋯',()=>dayMenu(row,day,'plan')):null);
   }),hours(row.summary?.planned_hours??row.planned_hours)];
  }));
  main.append(panel('Plán služeb',matrix,'group-plan'));return;
 }
 for(const row of rows){
  const cols=row.display_metrics??[],summary=row.summary??row,plannedTotals=summary.planned??row.planned,absences=summary.status_metrics??row.status_metrics;
  const grid=table(['Datum','Den','Průchod 1','Průchod 2',...cols.map(k=>k==='total'?'Plán (h)':(metricNames[k]??k)+' (h)')],row.days.map(day=>{
   const key=row.employment_id+':'+day.date,locked=row.shift_plan_locked||day.is_within_employment_period===false;
   const dayStatus=day.effective_status??day.status;
   const cell=side=>dayStatus?(statuses[dayStatus]??dayStatus):clock(day[side],{key,disabled:locked,label:day.date+' '+side+' úvazek '+row.employment_id,save:async value=>{await api(adminBase()+'shift-plan',{method:'PUT',body:{employment_id:row.employment_id,date:day.date,arrival_time:side==='arrival_time'?value:day.arrival_time??null,departure_time:side==='departure_time'?value:day.departure_time??null,status:null}});}});
   const date=new Date(day.date+'T12:00:00').toLocaleDateString('cs',{day:'numeric',month:'numeric'});
   return [locked||!!(dayStatus&&!day.status)?date:button(date,()=>dayMenu(row,day,'plan')),dayName(day.date),cell('arrival_time'),cell('departure_time'),...cols.map(k=>hours(k==='total'?day.planned_hours??day.planned?.total?.hours:day.planned?.[k]?.hours))];
  }));
  main.append(panel(row.display_label??row.employment_label,[
   el('div',{class:'sheet-heading'},el('strong',{},'Měsíční součet: '+hours(summary.planned_hours)),el('span',{class:'badge'},row.shift_plan_locked?'Uzamčeno':'Otevřeno'),isAdmin?button(row.shift_plan_locked?'Odemknout plán':'Zamknout plán',e=>lock(row,'SHIFT_PLAN',e.currentTarget)):null),
   el('div',{class:'metrics'},cols.filter(k=>k!=='total').map(k=>el('span',{class:'badge'},(metricNames[k]??k)+' '+hours(plannedTotals?.[k]?.hours)))),
   grid,absences?el('p',{},'Celodenní stavy: '+['holiday','sickness','paragraph'].map(k=>metricNames[k]+' '+hours(absences[k]?.hours)).join(' · ')):null
  ],'group-plan'));
 }
}
function selection(data){modal('Výběr úvazků pro zobrazení',close=>{
 const checks=data.available_employments.map(e=>el('label',{class:'check-field'},el('input',{type:'checkbox',value:e.id,checked:data.selected_employment_ids.includes(e.id)}),e.display_label));
 return el('div',{},checks,button('Použít výběr',async()=>{try{await api('api/v1/admin/shift-plan/selection',{method:'PUT',body:{year:state.year,month:state.month,employment_ids:checks.filter(c=>c.querySelector('input').checked).map(c=>+c.querySelector('input').value)}});close();await render();}catch(e){error(e);}},'primary'));});}
async function groups(){
 const main=heading('dochazka.admin.groups','Skupiny úvazků','Skupiny sdílejí plán služeb. Docházka a přístupy k dalším úvazkům zůstávají oddělené.');const {groups}=await api('api/v1/admin/employment-groups');
 const editor=async group=>{const {available_employments}=await api('api/v1/admin/shift-plan?'+monthQuery());modal(group?'Upravit skupinu':'Nová skupina',close=>{const form=el('form',{},field('Název','name','text',group?.name??'',{required:true}),available_employments.map(e=>el('label',{class:'check-field'},el('input',{name:'employment',type:'checkbox',value:e.id,checked:!!group?.members.some(m=>m.employment_id===e.id)}),e.display_label)),el('button',{type:'submit',class:'primary'},'Uložit'));form.addEventListener('submit',async e=>{e.preventDefault();try{const name=formData(form).name,ids=[...form.querySelectorAll('[name=employment]:checked')].map(n=>+n.value);if(group){await api('api/v1/admin/employment-groups/'+group.id,{method:'PUT',body:{name}});await api('api/v1/admin/employment-groups/'+group.id+'/members',{method:'PUT',body:{employment_ids:ids}});}else await api('api/v1/admin/employment-groups',{method:'POST',body:{name,employment_ids:ids}});close();await render();}catch(err){showError(form,err);}});return form;});};
 main.append(button('Nová skupina',()=>editor()),panel('Skupiny',table(['Název','Členové','Akce'],groups.map(g=>[g.name,g.members.map(m=>el('p',{},m.display_label)),el('div',{class:'actions'},button('Upravit',()=>editor(g)),button('Odstranit',()=>confirm('Odstranit skupinu','Úvazky ani jejich data nebudou odstraněny.',async()=>{await api('api/v1/admin/employment-groups/'+g.id,{method:'DELETE'});await render();})))]))));
}
async function prints(){const main=heading('dochazka.admin.prints','Tiskové sestavy','Vyberte období a úvazky. Výpočty a PDF poskytuje backend.');const {available_employments}=await api('api/v1/admin/shift-plan?'+monthQuery());const options=available_employments.map(e=>el('label',{class:'check-field'},el('input',{name:'employment',type:'checkbox',value:e.id}),e.display_label));main.append(monthBar(),panel('Vybrané úvazky',[...options,el('div',{class:'actions'},button('PDF plánu',()=>download('api/v1/admin/export/shift-plan/pdf',{method:'POST',body:{year:state.year,month:state.month,employment_ids:options.filter(n=>n.querySelector('input').checked).map(n=>+n.querySelector('input').value)},filename:'plan.pdf',exportId:'attendance-plan-pdf'}).catch(error)),button('Hromadný CSV / ZIP',()=>download('api/v1/admin/export?month='+state.year+'-'+String(state.month).padStart(2,'0')+'&bulk=true',{filename:'dochazka.zip',exportId:'attendance-csv-zip'}).catch(error)))]));}
async function render(){const generation=++state.generation;try{let task;if(state.view==='attendance')task=attendance;else if(['plan','group-plan'].includes(state.view))task=plan;else if(state.view==='groups')task=groups;else if(state.view==='prints')task=prints;else throw Error('Požadovaný pohled neexistuje.');const pending=task();document.querySelector('#content').dataset.generation=String(generation);await pending;}catch(e){if(generation===state.generation)error(e);}}
try{state.identity=await api('identity');await render();}catch(e){document.querySelector('#content').replaceChildren(notice(e.message,'error'));}
