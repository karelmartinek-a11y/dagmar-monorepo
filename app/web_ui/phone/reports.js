import {t} from './language.js';
import {check,facts,field,node,panel,press,select} from './dom.js';
import {dayText,hours,states} from './sheets.js';

const names = {
  total:'Odpracováno',afternoon:'Odpoledne',night:'Noc',weekend:'Víkend',public_holiday:'Svátek',
  holiday:'Dovolená',sickness:'Nemoc',paragraph:'Paragraf',
};
const timeOnly = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const report = {source:'attendance',variant:'detail',employees:null,exportId:''};

function labelPeriod(context) {
  const {year,month} = context.state;
  return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0');
}

function monthSelect(context,caption) {
  const {state,guard,render} = context;
  const control = node('input',null,{type:'month',min:'2000-01',max:'2100-12',required:''});
  control.value = labelPeriod(context);
  control.addEventListener('change',guard(async()=>{
    if (!control.validity.valid || !/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(control.value)) {
      control.value = labelPeriod(context);
      throw Error('Vyberte platný měsíc v letech 2000 až 2100.');
    }
    const [year,month] = control.value.split('-').map(Number);
    state.year = year;
    state.month = month;
    report.employees = null;
    report.exportId = '';
    await render();
  }));
  return field(caption,control);
}

async function prepare(context,route,options,file,host) {
  const {signal,request} = context;
  const type = file.split('.').at(-1);
  const media = {pdf:'application/pdf',csv:'text/csv',zip:'application/zip'}[type];
  const limit = type==='pdf' ? 50000000 : 16*1024*1024;
  const blob = await request(route,{...options,media,signal});
  if (signal.aborted) return;
  if (!blob.size || blob.size>limit) throw Error('Služba neposkytla soubor v povolené velikosti.');
  const bytes = new Uint8Array(await (type==='csv' ? blob : blob.slice(0,5)).arrayBuffer());
  const shape = type==='pdf' ? new TextDecoder('ascii').decode(bytes)==='%PDF-' :
    type==='zip' ? bytes[0]===80 && bytes[1]===75 && [3,5].includes(bytes[2]) :
      !bytes.includes(0) && !/^\s*[<{]/.test(new TextDecoder().decode(bytes.slice(0,64)));
  if (!shape) throw Error('Služba neposkytla platný soubor v požadovaném formátu.');
  const link = URL.createObjectURL(blob);
  const anchor = node('a','Stáhnout '+file,{href:link,download:file});
  const release = ()=>URL.revokeObjectURL(link);
  signal.addEventListener('abort',release,{once:true});
  host.replaceChildren(anchor);
  anchor.focus();
}

export async function showReports(context) {
  const {state,root,signal,month,request,go,guard,render} = context;
  if (!state.identity.admin) throw Error('Tento přehled je dostupný správci.');
  const preview = ['print-plan','print-summary'].includes(state.view);
  if (preview) return showPreview(context);
  const isExport = state.view==='export';
  const form = panel(isExport ? 'Skutečná docházka' : 'Zadání tiskové sestavy',
    monthSelect(context,isExport?'Měsíc exportu':'Měsíc sestavy'));
  root.append(form);
  const choosePlan = !isExport && report.source==='shift_plan';
  const source = await request(choosePlan?'api/v1/admin/shift-plan':'api/v1/admin/attendance/month',{params:month(),signal});
  if (signal.aborted) return;
  const employees = choosePlan ?
    source.available_employments.map(row=>({id:row.id,name:row.display_label,active:row.is_active_in_month!==false})) :
    source.data.map(row=>({id:row.employment_id,name:row.employment_label,active:row.is_active_in_month!==false}));
  if (isExport) {
    const valid = employees.some(item=>String(item.id)===report.exportId);
    const selectId = select([['','Všechny dostupné úvazky · ZIP'],...employees.map(item=>[item.id,item.name])],valid?report.exportId:'');
    const file = node('p',null,{role:'status'});
    const exportButton = press('Připravit soubor',guard(async()=>{
      exportButton.disabled = selectId.disabled = true;
      file.textContent = t('Připravuji export…');
      try {
        const id = selectId.value;
        await prepare(context,'api/v1/admin/export',{
          params:{month:labelPeriod(context),...(id?{employment_id:id}:{bulk:'true'})},
        },id?'dochazka.csv':'dochazka.zip',file);
      } catch(error) {
        if (!signal.aborted) file.textContent = t(error.message);
      } finally {
        exportButton.disabled = selectId.disabled = false;
      }
    }),true);
    selectId.addEventListener('change',()=>{
      report.exportId = selectId.value;
      file.replaceChildren();
    });
    form.append(field('Rozsah exportu',selectId),node('p','Soubory obsahují skutečné průchody a hodinové metriky v UTF‑8.'),exportButton,file);
    if (!employees.length) form.append(node('p','V období nejsou dostupné žádné úvazky.'));
    return;
  }

  const type = select([['attendance','Docházka'],['shift_plan','Plán služeb']],report.source);
  const variant = select([['detail','Podrobná'],['summary','Souhrnná']],report.variant);
  type.addEventListener('change',guard(async()=>{
    report.source = type.value;
    report.employees = null;
    await render();
  }));
  variant.addEventListener('change',()=>{report.variant=variant.value;});
  form.append(field('Druh dokumentu',type));
  if (!choosePlan) form.append(field('Podoba docházky',variant));
  const eligible = new Set(employees.filter(item=>item.active).map(item=>item.id));
  report.employees ??= [...eligible];
  report.employees = report.employees.filter(id=>eligible.has(id));
  const fields = employees.map(row=>{
    const item = check(row.name,row.id,report.employees.includes(row.id));
    item.input.disabled = !row.active;
    return item;
  });
  const total = node('p',null,{role:'status'});
  const open = press('Otevřít náhled',guard(()=>go(choosePlan?'print-plan':'print-summary')),true);
  const pick = node('div',null,{class:'group'});
  pick.append(press('Vybrat všechny úvazky',()=>{
    fields.forEach(item=>{item.input.checked=!item.input.disabled;});
    sync();
  }),press('Zrušit výběr',()=>{
    fields.forEach(item=>{item.input.checked=false;});
    sync();
  }));
  function sync() {
    report.employees = fields.filter(item=>item.input.checked).map(item=>Number(item.input.value));
    total.textContent = t('Vybráno úvazků')+' '+report.employees.length;
    open.disabled = !report.employees.length;
  }
  for (const row of fields) row.input.addEventListener('change',sync);
  sync();
  form.append(node('h3','Úvazky'),pick,total,...fields.map(row=>row.box),open);
}

async function showPreview(context) {
  const {state,root,signal,month,request,go,guard} = context;
  const back = press('Zpět na výběr',guard(()=>go('prints')));
  const actions = node('div',null,{class:'group hide-print'});
  actions.append(back);
  root.append(actions);
  if (!report.employees?.length) {
    root.append(node('p','Nejdřív vyberte úvazky pro sestavu.'));
    return;
  }
  const selected = [...report.employees];
  const plan=state.view==='print-plan';
  const summary=report.variant==='summary'&&!plan;
  const body = (await request('api/v1/admin/attendance/month',{params:month(),signal})).data;
  if (signal.aborted) return;
  const sheets = selected.map(id=>body.find(row=>row.employment_id===id));
  if (sheets.some(row=>!row)) throw Error('Některý úvazek už není dostupný. Obnovte výběr.');
  const printable = summary||plan||sheets.every(row=>row.days.every(day=>day.events.length<=8));
  const print = press('Tisk / PDF',()=>window.print(),true);
  print.disabled = !printable;
  actions.prepend(print);
  if (plan) {
    const file = node('p',null,{role:'status',class:'hide-print'});
    const preparePdf = press('Připravit PDF',guard(async()=>{
      preparePdf.disabled = true;
      try {
        await prepare(context,'api/v1/admin/export/shift-plan/pdf',{method:'POST',data:{
          ...month(),employment_ids:selected,locale:state.locale,
        }},'plan.pdf',file);
      } finally {
        preparePdf.disabled = false;
      }
    }));
    actions.append(preparePdf,file);
  }
  actions.append(press('Kompletní export',guard(()=>go('export'))));
  if (!printable) root.append(node('p','Denní detail překračuje osm průchodů. Zobrazení zachovává všechny časy. Pro tisk úplných dat použijte CSV.',{role:'alert'}));
  for (const row of sheets) {
    const summaryRows = [...row.display_metrics,'holiday','sickness','paragraph'].map(key=>[
      names[key] ?? key,hours((row[plan?'planned':'worked']?.[key] ?? row.status_metrics?.[key])?.hours,state.locale),
    ]);
    const paper = panel(row.employment_label,node('p',labelPeriod(context)),
      facts([...summaryRows,['Plánované hodiny',hours(row.planned_hours,state.locale)]]));
    paper.classList.add('paper');
    if (!summary) {
      const days = node('dl');
      for (const day of row.days) {
        const dayStatus=plan?day.planned_status:day.effective_status;
        const eventTimes=plan?[day.planned_arrival_time,day.planned_departure_time].filter(Boolean).map(value=>String(value).slice(0,5)) :
          day.events.map(event=>timeOnly.format(new Date(event.occurred_at)));
        const values = [day.public_holiday_label,dayStatus?states.get(dayStatus)??dayStatus:null,...eventTimes].filter(Boolean);
        days.append(node('dt',dayText(day.date,state.locale)),node('dd',values.join(' · ')||'—'));
      }
      paper.append(days);
    }
    root.append(paper);
  }
}
