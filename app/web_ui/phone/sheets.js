import {t} from './language.js';
import {facts,field,node,panel,press,select,check} from './dom.js';

export const states = new Map([['HOLIDAY','Dovolená'],['SICKNESS','Nemoc'],['PARAGRAPH','Paragraf'],['OFF','Volno']]);
const metrics = {
  total:'Odpracováno',afternoon:'Odpoledne',night:'Noc',weekend:'Víkend',public_holiday:'Svátek',
  holiday:'Dovolená',sickness:'Nemoc',paragraph:'Paragraf',
};
export const hours = (value,lang)=>value==null ? '—' :
  new Intl.NumberFormat(lang,{minimumFractionDigits:1,maximumFractionDigits:1}).format(value)+' h';
const details = (value='')=>value ? String(value).slice(0,5) : '';
const time = value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
function parseTime(text) {
  const value = text.trim();
  if (!value) return '';
  const parts = value.split(/[:.,]/);
  if (parts.length>2 || !parts.every(part=>/^\d+$/.test(part))) return undefined;
  let [hh,mm] = parts;
  if (mm===undefined && hh.length>2) {
    mm = hh.slice(-2);
    hh = hh.slice(0,-2);
  }
  if (hh.length>2 || (mm!==undefined && mm.length!==2) || Number(hh)>23 || Number(mm??0)>59) return undefined;
  return hh.padStart(2,'0')+':'+(mm ?? '00');
}
export const dayText = (value,lang)=>new Intl.DateTimeFormat(lang,{timeZone:'Europe/Prague',weekday:'short',day:'numeric',month:'numeric'}).format(new Date(value+'T12:00:00Z'));

function values(names,data,context) {
  return facts(names.map(name=>[metrics[name] ?? name,hours(data?.[name]?.hours,context.state.locale)]));
}

export function dialog(title,content,closeLabel='Zavřít') {
  const box = node('dialog',null,{'aria-label':title});
  box.append(node('h2',title),content,press(closeLabel,()=>box.close()));
  box.addEventListener('close',()=>box.remove(),{once:true});
  document.body.append(box);
  box.showModal();
  return box;
}

export function approval(title,note,complete) {
  const form = node('div');
  const issue = node('p',null,{role:'status'});
  const yes = press('Potvrdit',async()=>{
    yes.disabled = true;
    try {
      await complete();
      modal.close();
    } catch(error) {
      issue.textContent = t(error.message);
      yes.disabled = Boolean(error.uncertain);
    }
  },true);
  form.append(node('p',note),issue,yes);
  const modal = dialog(title,form,'Zrušit');
}

export async function showSheet(context,kind) {
  const {state,root,request,signal,month,guard,render} = context;
  const plan = kind==='plan';
  const entry = 'api/v1/'+(state.identity.admin?'admin/':'');
  const toolbar = panel(null,...context.period());
  root.append(toolbar);
  let rows = [];
  let candidates = [];
  if (state.identity.admin) {
    if (plan) {
      const available = await request(entry+'shift-plan',{params:month(),signal});
      rows = available.rows;
      if (!signal.aborted) toolbar.append(press('Vybrat úvazky',()=>chooseEmployment(context,available)));
    } else rows = (await request(entry+'attendance/month',{params:month(),signal})).data;
    candidates = rows.map(row=>[row.employment_id,row.display_label ?? row.employment_label]);
  } else {
    const list = await request(entry+'attendance/employments',{params:month(),signal});
    if (signal.aborted) return;
    candidates = list.map(item=>[item.id,item.label]);
    if (!candidates.some(([id])=>id===state.employment)) state.employment=candidates[0]?.[0];
    if (state.employment) {
      const sheet = await request(entry+'attendance',{params:{...month(),employment_id:state.employment},signal});
      if (plan) sheet.days=sheet.days.map(day=>({...day,arrival_time:day.planned_arrival_time,
        departure_time:day.planned_departure_time,status:day.planned_status}));
      rows = [sheet];
    }
  }
  if (signal.aborted) return;
  if (!candidates.length) {
    root.append(node('p','Ve zvoleném měsíci není dostupný žádný úvazek.'));
    return;
  }
  if (!candidates.some(([id])=>id===state.employment)) state.employment=candidates[0][0];
  const choice = select(candidates,state.employment);
  choice.addEventListener('change',guard(async()=>{
    state.employment = Number(choice.value);
    await render();
  }));
  toolbar.append(field('Úvazek',choice));
  const row = rows.find(sheet=>sheet.employment_id===state.employment);
  if (row) mountSheet(context,row,kind,entry);
}

function mountSheet(context,row,kind,entry) {
  const {state,root,month,request} = context;
  const plan = kind==='plan';
  const period = month();
  const label = row.display_label ?? row.employment_label;
  const locked = plan ? row.shift_plan_locked : row.attendance_locked;
  const totals = row.summary ?? row;
  const names = row.display_metrics ?? [];
  const summary = panel(label,node('p',locked ? 'Uzamčeno' : 'Otevřeno'));
  if (plan) summary.append(node('p','Plán za měsíc · '+hours(totals.planned_hours,state.locale)));
  summary.append(values(plan ? names.filter(name=>name!=='total') : names,totals[plan?'planned':'worked'],context));
  summary.append(values(['holiday','sickness','paragraph'],totals.status_metrics,context));
  if (state.identity.admin) {
    const key = state.year+':'+state.month+':'+row.employment_id+':lock:'+kind;
    const action = press(locked?'Odemknout měsíc':'Uzamknout měsíc',context.guard(async()=>{
      action.disabled = true;
      try {
        await context.update(key,()=>request(entry+'locks',{method:'PUT',data:{
          year:period.year,month:period.month,lock_type:plan?'shift_plan':'attendance',locked:!locked,
          employment_ids:[row.employment_id],
        }}));
      } finally {
        action.disabled = state.unconfirmed.has(key);
      }
    }));
    action.disabled = state.pending.has(key)||state.unconfirmed.has(key);
    summary.append(action);
    if (!plan) summary.append(press('Přidej pauzy',()=>approval('Doplnit zákonné přestávky',
      'Doplnění změní docházkové časy ve zvoleném období. Ověřte úvazek a měsíc před potvrzením.',
      ()=>context.update(key+':breaks',()=>request(entry+'attendance/breaks',{method:'POST',data:{
        employment_id:row.employment_id,...period,confirmed:true,
      }})))));
  }
  root.append(summary);
  for (const day of row.days) root.append(dayRow(context,row,day,kind,entry,locked));
}

function dayRow(context,row,day,kind,entry,locked) {
  const state = context.state;
  const plan = kind==='plan';
  const key = [state.year,state.month,row.employment_id,day.date,kind].join(':');
  const disabled = locked || day.is_within_employment_period===false || state.unconfirmed.has(key);
  const status = day.effective_status ?? day.status;
  const dateline = node('div',null,{class:'day-title'});
  dateline.append(node('h3',dayText(day.date,state.locale)));
  const area = panel(null,dateline);
  const notice = node('p',null,{role:'status'});
  const clocks = node('div',null,{class:'time-rows'});
  if (!disabled && !(plan && status && !day.status)) {
    const menu = press('Stav dne',()=>changeStatus(context,row,day,entry,kind,key));
    menu.setAttribute('aria-label',t('Stav dne')+' '+dayText(day.date,state.locale));
    dateline.append(menu);
  }
  if (status) area.append(node('p',states.get(status) ?? status));
  else if (plan) {
    for (const [index,side] of ['arrival_time','departure_time'].entries()) {
      clocks.append(makeClock(details(day[side]),index,value=>context.request(entry+'shift-plan',{method:'PUT',data:{
        employment_id:row.employment_id,date:day.date,status:null,
        arrival_time:side==='arrival_time'?value:day.arrival_time??null,
        departure_time:side==='departure_time'?value:day.departure_time??null,
      }})));
    }
  } else {
    const events = day.events ?? [];
    for (let index=0;index<Math.max(4,events.length+1);index++) {
      const event=events[index];
      clocks.append(makeClock(event?time(event.occurred_at):'',index,async value=>{
        if (!value && event) {
          await context.request(entry+'attendance/events/'+event.id,{method:'DELETE',
            params:event.deletion_partner_id?{paired_event_id:event.deletion_partner_id}:undefined});
        } else if (value) await context.request(entry+'attendance/events'+(event?'/'+event.id:''),{
          method:event?'PUT':'POST',data:{employment_id:row.employment_id,occurred_at:day.date+'T'+value+':00'},
        });
      }));
    }
    if (day.planned_arrival_time || day.planned_departure_time) {
      area.append(node('p','Plán '+[day.planned_arrival_time,day.planned_departure_time].filter(Boolean).map(details).join(' – ')));
    }
  }
  if (state.unconfirmed.has(key)) notice.textContent = t('Výsledek čeká na nové načtení uloženého přehledu.');
  area.append(clocks,notice);
  const daily = values(row.display_metrics??[],day[plan?'planned':'worked'],context);
  if (daily.childElementCount) {
    const hoursDetails = node('details');
    hoursDetails.append(node('summary','Hodinové metriky dne'),daily);
    area.append(hoursDetails);
  }
  return area;

  function makeClock(original,index,submit) {
    const identity = key+':'+index;
    const control = node('input',null,{type:'text',inputmode:'numeric',maxlength:'5',placeholder:'hh:mm'});
    control.value = original;
    control.disabled = disabled || state.pending.has(key);
    control.dataset.clock = identity;
    const wrapper = field('Průchod '+(index+1),control);
    async function save(nextControl) {
      if (control.disabled || control.value===original || state.pending.has(key)) return;
      const next = parseTime(control.value);
      if (next===undefined) {
        notice.textContent = t('Zadejte čas od 0:00 do 23:59.');
        control.setAttribute('aria-invalid','true');
        control.focus({preventScroll:true});
        return;
      }
      const inputs = [...clocks.querySelectorAll('input')];
      inputs.forEach(input=>{input.disabled=true;});
      notice.textContent = t('Ukládám a ověřuji čas…');
      try {
        await context.update(key,()=>submit(next || null),nextControl ?? identity);
      } catch(error) {
        notice.textContent = t(error.message);
        control.setAttribute('aria-invalid','true');
        if (!state.unconfirmed.has(key)) control.focus({preventScroll:true});
      } finally {
        inputs.forEach(input=>{input.disabled=disabled || state.unconfirmed.has(key);});
      }
    }
    control.addEventListener('change',()=>void save());
    control.addEventListener('keydown',event=>{
      if (event.key==='Enter' || (event.key==='Tab' && control.value!==original)) {
        const clocks = [...context.root.querySelectorAll('[data-clock]:not(:disabled)')];
        const target = clocks[clocks.indexOf(control)+(event.shiftKey?-1:1)];
        event.preventDefault();
        void save(event.key==='Tab' ? target?.dataset.clock : undefined);
      }
      if (event.key==='Escape' && !state.pending.has(key)) {
        control.value = original;
        control.removeAttribute('aria-invalid');
        notice.textContent = '';
      }
    });
    control.addEventListener('input',()=>control.removeAttribute('aria-invalid'));
    if (original && !disabled) wrapper.append(press('Vymazat čas',()=>{
      control.value = '';
      void save();
    }));
    return wrapper;
  }
}

function changeStatus(context,row,day,entry,kind,key) {
  const plan = kind==='plan';
  const list = node('div',null,{class:'group'});
  const feedback = node('p',null,{role:'status'});
  const actions = [...states].filter(([id])=>!plan || ['HOLIDAY','OFF'].includes(id));
  const box = dialog(t('Celodenní stav')+' · '+dayText(day.date,context.state.locale),list);
  for (const [status,name] of [...actions,['','Zrušit celodenní stav']]) {
    const button = press(name,async()=>{
      if (plan && status && !window.confirm(name+' pro '+day.date+'?')) return;
      for (const item of list.querySelectorAll('button')) item.disabled = true;
      try {
        await context.update(key,()=>context.request(plan?entry+'shift-plan':
          entry+(context.state.identity.admin?'day-status':'attendance/day-status'),{method:'PUT',data:{
          employment_id:row.employment_id,date:day.date,status:status||null,
          ...(plan?{arrival_time:null,departure_time:null}:{}),
        }}));
        box.close();
      } catch(error) {
        feedback.textContent = error.message;
        for (const item of list.querySelectorAll('button')) item.disabled = context.state.unconfirmed.has(key);
      }
    });
    button.disabled = plan && !status && !day.status;
    list.append(button);
  }
  list.append(feedback);
}

function chooseEmployment(context,data) {
  const values = data.available_employments.map(row=>check(row.display_label,row.id,data.selected_employment_ids.includes(row.id)));
  const contents = node('div');
  const issue = node('p',null,{role:'status'});
  contents.append(...values.map(row=>row.box),issue);
  const month = context.month();
  const key = month.year+':'+month.month+':plan-selection';
  const apply = press('Použít výběr',async()=>{
    apply.disabled = true;
    try {
      await context.update(key,()=>context.request('api/v1/admin/shift-plan/selection',{method:'PUT',data:{
        ...month,employment_ids:values.filter(row=>row.input.checked).map(row=>Number(row.input.value)),
      }}));
      box.close();
    } catch(error) {
      issue.textContent = t(error.message);
      apply.disabled = context.state.unconfirmed.has(key);
    }
  },true);
  contents.append(apply);
  const box = dialog('Výběr úvazků pro zobrazení',contents);
}
