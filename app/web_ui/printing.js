import {el,field,select,button,table,panel,notice} from './ui.js';
import {api,download} from './api.js';

const metrics={total:'Odpracováno',afternoon:'Odpoledne',night:'Noc',weekend:'Víkend',public_holiday:'Svátek'};
const absences={holiday:'Dovolená',sickness:'Nemoc',paragraph:'Paragraf'};
const statuses={HOLIDAY:'Dovolená',SICKNESS:'Nemoc',PARAGRAPH:'Paragraf',OFF:'Volno'};
const types={WORK_CONTRACT:'Pracovní smlouva',DPP_DPC:'DPP / DPČ',TASK_SHIFT_BASED:'Úkolová / směnová odměna',EXTERNAL_HOURLY:'Externí hodinová fakturace'};
const hours=value=>value===null||value===undefined?'—':Number(value).toLocaleString('cs-CZ',{minimumFractionDigits:1,maximumFractionDigits:1})+' h';
const time=value=>value?new Date(value).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'}):'—';
const monthValue=state=>state.year+'-'+String(state.month).padStart(2,'0');
const period=state=>new URLSearchParams({year:state.year,month:state.month});
const monthLabel=state=>new Date(state.year,state.month-1,15).toLocaleDateString('cs-CZ',{month:'long',year:'numeric'});

export async function printing({state,heading,error,render}){
 if(!state.identity.admin)throw Error('Tato sestava vyžaduje přístup správce docházky.');
 const generation=state.generation,current=()=>generation===state.generation;
 const options=state.printOptions??={type:'attendance',kind:'detail',ids:null,exportId:''};
 const updateMonth=label=>{
  const wrapper=field(label,'print-month','month',monthValue(state),{required:true,min:'2000-01',max:'2100-12'});
  wrapper.querySelector('input').addEventListener('change',event=>{
   const input=event.target,match=input.value.match(/^(20\d\d|2100)-(0[1-9]|1[0-2])$/);
   if(!input.validity.valid||!match){input.value=monthValue(state);error(Error('Vyberte platný měsíc od roku 2000 do 2100.'));return;}
   state.year=+match[1];state.month=+match[2];options.ids=null;options.exportId='';render();
  });return wrapper;
 };
 const run=async(control,task)=>{
  if(control.disabled)return;control.disabled=true;
  try{await task();}catch(e){if(current())error(e);}finally{if(current()&&control.isConnected)control.disabled=false;}
 };
 const exportFile=(control,id='')=>run(control,()=>download('api/v1/admin/export?'+new URLSearchParams({month:monthValue(state),...(id?{employment_id:String(id)}:{bulk:'true'})}),{filename:id?'dochazka.csv':'dochazka.zip',exportId:id?'attendance-csv':'attendance-csv-zip'}));
 const showExport=()=>{state.view='export';render();};

 if(state.view==='export'){
  const main=heading('dochazka.admin.export','Export docházky','Stáhněte skutečnou docházku do CSV nebo ZIP pro další zpracování.');
  main.append(panel('Export skutečné docházky',notice('Načítání úvazků…'),'export'));
  const {data}=await api('api/v1/admin/attendance/month?'+period(state));if(!current())return;
  if(!data.some(row=>String(row.employment_id)===options.exportId))options.exportId='';
  const scope=select('Rozsah exportu','export-employment',[['','Všechny úvazky (ZIP)'],...data.map(row=>[String(row.employment_id),row.employment_label])],options.exportId);
  const action=button(options.exportId?'Stáhnout CSV':'Stáhnout CSV / ZIP',event=>exportFile(event.currentTarget,options.exportId),'primary');
  scope.querySelector('select').addEventListener('change',event=>{options.exportId=event.target.value;action.textContent=options.exportId?'Stáhnout CSV':'Stáhnout CSV / ZIP';});
  const last=new Date(state.year,state.month,0).getDate(),info=el('div',{class:'export-info'},[
   ['Období','1. '+state.month+'. – '+last+'. '+state.month+'. '+state.year],
   ['Sloupce','Datum, úvazek, skutečné průchody a hodinové metriky'],['Kódování','UTF-8']
  ].map(([label,value])=>el('div',{},el('small',{},label),el('strong',{},value))));
  const content=el('div',{},el('div',{class:'print-controls'},updateMonth('Měsíc exportu *'),scope),notice('Export obsahuje skutečnou docházku vybraných úvazků. Plán směn má samostatné tiskové sestavy.'),info,!data.length?notice('V tomto měsíci nejsou dostupné žádné úvazky.'):null,el('div',{class:'print-footer actions'},action));
  main.querySelector('.panel').replaceWith(panel('Export skutečné docházky',content,'export'));return;
 }
 if(state.view==='prints'){
  const main=heading('dochazka.admin.prints','Tiskové sestavy','Vyberte dokument, měsíc a pracovní úvazky pro tiskový náhled.');
  main.append(panel('Tiskové sestavy',notice('Načítání úvazků…'),'print'));
  let choices;
  if(options.type==='shift_plan')choices=(await api('api/v1/admin/shift-plan?'+period(state))).available_employments.map(row=>({id:row.id,label:row.display_label,active:row.is_active_in_month!==false}));
  else choices=(await api('api/v1/admin/attendance/month?'+period(state))).data.map(row=>({id:row.employment_id,label:row.employment_label,active:row.is_active_in_month!==false}));
  if(!current())return;
  const available=new Set(choices.filter(row=>row.active).map(row=>row.id));
  options.ids=options.ids===null?[...available]:options.ids.filter(id=>available.has(id));
  const type=select('Typ dokumentu','print-type',[['attendance','Docházka'],['shift_plan','Plán služeb']],options.type);
  type.querySelector('select').addEventListener('change',event=>{options.type=event.target.value;options.ids=null;render();});
  const kind=select('Varianta docházky','print-kind',[['detail','Detailní'],['summary','Souhrnná']],options.kind);
  kind.querySelector('select').addEventListener('change',event=>{options.kind=event.target.value;});
  const count=el('span',{class:'badge','aria-live':'polite'}),open=button('Otevřít náhled',()=>{state.view=options.type==='shift_plan'?'print-plan':'print-summary';render();},'primary');
  const sync=()=>{count.textContent='Vybráno úvazků: '+options.ids.length;open.disabled=!options.ids.length;};
  const checks=choices.map(row=>{
   const input=el('input',{name:'employment',type:'checkbox',value:row.id,checked:options.ids.includes(row.id),disabled:!row.active});
   input.addEventListener('change',()=>{options.ids=checks.filter(node=>node.querySelector('input').checked).map(node=>+node.querySelector('input').value);sync();});
   return el('label',{class:'check-field print-employment'},input,el('span',{},row.label),!row.active?el('small',{},'Mimo vybraný měsíc'):null);
  });
  const choose=all=>{options.ids=all?[...available]:[];checks.forEach(node=>{const input=node.querySelector('input');input.checked=options.ids.includes(+input.value);});sync();};
  const content=el('div',{},el('div',{class:'print-controls'},type,options.type==='attendance'?kind:null,updateMonth('Měsíc *')),el('h3',{},'VYBERTE ÚVAZKY'),el('div',{class:'actions'},button('Vybrat všechny úvazky',()=>choose(true)),button('Zrušit výběr',()=>choose(false)),count),el('div',{class:'print-employments'},checks.length?checks:notice('V tomto měsíci nejsou dostupné žádné úvazky.')),notice(options.type==='shift_plan'?'Plán služeb obsahuje plánované průchody a měsíční součty.':'Docházka obsahuje skutečné průchody a součty. Souhrnná varianta uvádí pouze měsíční metriky.'),el('div',{class:'print-footer actions'},open));
  sync();main.querySelector('.panel').replaceWith(panel('Tiskové sestavy',content,'print'));return;
 }
 const plan=state.view==='print-plan',summary=!plan&&options.kind==='summary',title=plan?'Plán služeb':summary?'Souhrnná docházka':'Detailní docházka';
 const main=heading(plan?'dochazka.print.plan':'dochazka.print.summary','Náhled '+(plan?'plánu služeb':summary?'souhrnné docházky':'detailní docházky'),'Zkontrolujte skutečné údaje před tiskem nebo uložením do PDF.');
 const back=button('Zpět na výběr',()=>{state.view='prints';render();});
 if(!options.ids?.length){main.append(notice('Nejprve vyberte alespoň jeden úvazek.'),back);return;}
 const selected=[...options.ids],year=state.year,month=state.month;
 const printAction=button('Tisk / PDF',()=>window.print(),'primary');printAction.disabled=true;
 const actions=el('div',{class:'actions print-toolbar'},printAction,plan?button('Stáhnout PDF',event=>run(event.currentTarget,()=>download('api/v1/admin/export/shift-plan/pdf',{method:'POST',body:{year,month,employment_ids:selected},filename:'plan.pdf',exportId:'attendance-plan-pdf'}))):null,button('Kompletní export',showExport),back);
 const documentHost=el('div',{class:'print-documents'},notice('Načítání dokumentu…'));main.append(panel('Náhled dokumentu',[actions,documentHost],'print'));
 const {data}=await api('api/v1/admin/attendance/month?'+period(state));if(!current())return;
 const sheets=selected.map(id=>data.find(row=>row.employment_id===id));
 if(sheets.some(row=>!row))throw Error('Některý vybraný úvazek už není dostupný. Vraťte se na výběr a obnovte jej.');
 documentHost.replaceChildren(...sheets.map((sheet,index)=>{
  const paper=el('article',{class:'print-paper'+(summary?' print-paper-summary':''),'data-employment':sheet.employment_id},el('header',{class:'print-paper-header'},el('div',{},el('h2',{},title),el('strong',{},sheet.user_name??sheet.employment_label),el('p',{},sheet.employment_title??''),el('p',{},types[sheet.employment_type]??sheet.employment_type??'')),el('strong',{},monthLabel(state))));
  const cols=sheet.display_metrics??[],source=plan?'planned':'worked';
  if(summary){
   paper.append(table(['Metrika','Hodnota'],[...cols.map(key=>[metrics[key]??key,hours(sheet.worked?.[key]?.hours)]),...Object.entries(absences).map(([key,label])=>[label,hours(sheet.status_metrics?.[key]?.hours)]),['Plánované hodiny',hours(sheet.planned_hours)]]));
  }else{
   const count=plan?8:Math.max(8,...sheet.days.map(day=>day.events.length));
   const rows=sheet.days.map(day=>{
    const status=plan?day.planned_status:day.effective_status,hasEvents=!plan&&day.events.length>0;
    const values=plan?[day.planned_arrival_time??'',day.planned_departure_time??'']:day.events.map(event=>time(event.occurred_at));
    return [el('div',{},new Date(day.date+'T12:00:00').toLocaleDateString('cs-CZ',{day:'numeric',month:'numeric'}),hasEvents&&status?el('small',{},statuses[status]??status):null),new Date(day.date+'T12:00:00').toLocaleDateString('cs-CZ',{weekday:'short'}),...Array.from({length:count},(_,i)=>status&&!hasEvents?(i===0?(statuses[status]??status):''):values[i]??''),...cols.map(key=>hours(day[source]?.[key]?.hours))];
   });
   paper.append(table(['Datum','Den',...Array.from({length:count},(_,i)=>'PRŮCHOD '+(i+1)),...cols.map(key=>(plan&&key==='total'?'Plán':metrics[key]??key)+' (h)')],rows));
   paper.append(el('div',{class:'print-summary'},cols.map(key=>el('span',{},(plan&&key==='total'?'Plán':metrics[key]??key)+': '+hours(sheet[source]?.[key]?.hours))),el('span',{},'Plánované hodiny: '+hours(sheet.planned_hours))));
   if(sheet.days.some(day=>day.public_holiday_label))paper.append(el('p',{},sheet.days.filter(day=>day.public_holiday_label).map(day=>day.date+': '+day.public_holiday_label).join(' · ')));
  }
  const scroll=paper.querySelector('.table-scroll');scroll.setAttribute('role','region');scroll.setAttribute('aria-label',title+' – '+sheet.employment_label);
  paper.append(el('p',{class:'print-absence'},Object.entries(absences).map(([key,label])=>label+': '+hours(sheet.status_metrics?.[key]?.hours)).join(' · ')),el('footer',{class:'print-paper-footer'},el('span',{},'KájovoDocházka'),el('span',{},'Dokument '+(index+1)+' / '+sheets.length)));
  return paper;
 }));
 printAction.disabled=false;
}
