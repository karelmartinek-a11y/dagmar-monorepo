import {el,icon,button,table,panel,notice} from './ui.js';
import {api} from './api.js';

const routes=[['GET','/health','Stav integračního klienta'],['GET','/openapi.json','Chráněný kontrakt API'],['GET','/employments','Přidělené úvazky'],['GET','/attendance-events','Chronologické průchody'],['POST','/attendance-events','Vytvoření průchodu'],['PATCH','/attendance-events/{event_id}','Úprava průchodu'],['DELETE','/attendance-events/{event_id}','Odstranění průchodu'],['GET','/locks','Měsíční zámky']];
const errors=[['400','Neplatný vstup'],['401','Neplatný nebo chybějící token'],['403','Nedostatečná oprávnění'],['409','Konflikt změny'],['423','Zamčené období'],['429','Překročený limit']];
const info=items=>el('div',{class:'admin-info-grid'},items.map(([label,value])=>el('div',{class:'admin-info-item'},el('small',{},label),el('strong',{},value))));
const card=(key,title,value,detail,ico)=>el('section',{class:'admin-stat','data-stat':key},el('div',{class:'admin-stat-label'},el('span',{},title),icon(ico)),el('strong',{class:'admin-stat-value'},value),el('p',{},detail));

export async function adminInfo({state,heading,render}){
 const generation=state.generation,docs=state.view==='public-docs';
 if(!docs&&!state.identity.admin)throw Error('Tento přehled vyžaduje přístup správce docházky.');
 const go=view=>{state.view=view;render();};
 if(state.view==='overview'){
  const main=heading('dochazka.admin.overview','Docházka · přehled správce','Rychlý provozní rozcestník a orientační souhrn počtů.');
  const statistics=el('div',{class:'admin-statistics','aria-live':'polite'},card('users','Uživatelé: celkem','Načítání','Načítání aktivních uživatelů','users'),card('clients','Integrační klienti','Načítání','Načítání aktivních klientů','link'),card('health','Systém odpovídá','Načítání','Ověřování dostupnosti služby','shield'));
  const quick=(view,title,description,ico)=>el('button',{type:'button',class:'admin-quick','aria-label':title,onclick:()=>go(view)},icon(ico),el('span',{},el('strong',{},title),el('small',{},description)));
  const environment=el('div',{},notice('Načítání informací o prostředí…'));
  main.append(statistics,panel('Provozní agendy',el('div',{class:'admin-quick-grid'},quick('attendance','Docházkové listy','Skutečné průchody a měsíční zámky','attendance'),quick('plan','Plán služeb','Plánování směn a nepřítomností','calendar'),quick('export','Export a uzávěrka','CSV a ZIP za vybrané úvazky','export')),'clock'),panel('Informace o prostředí',environment,'info'),button('Obnovit přehled',render));
  const list=(path,key)=>api(path).then(value=>{const rows=key?value[key]:value;if(!Array.isArray(rows))throw Error('Neplatná odpověď přehledu.');return rows;});
  const [users,clients,version,health]=await Promise.allSettled([list('api/v1/admin/users','users'),list('api/v1/admin/integrations/clients'),api('api/version'),api('api/v1/health')]);
  if(generation!==state.generation)return;
  const available=result=>result.status==='fulfilled',count=(result,predicate)=>available(result)?(predicate?result.value.filter(predicate).length:result.value.length):'N/A';
  statistics.replaceChildren(card('users','Uživatelé: celkem',count(users),'Aktivní uživatelé: '+count(users,row=>row.is_active===true),'users'),card('clients','Integrační klienti',count(clients),'Aktivní klienti: '+count(clients,row=>row.status==='ACTIVE'),'link'),card('health','Systém odpovídá',available(health)&&health.value.ok===true?'Ano':'Nedostupné','Dostupnost služby ověřená požadavkem','shield'));
  environment.replaceChildren(info([['Prostředí',available(version)?version.value.environment:'N/A'],['Verze backendu',available(version)?version.value.backend_deploy_tag:'N/A'],['Datová autorita','Docházková služba'],['Časové pásmo','Europe/Prague'],['API namespace','/api/v1'],['Správa účtů a úvazků','Centrální Správa uživatelů']]));
  if([users,clients,version,health].some(result=>!available(result)))main.append(notice('Část dat není dostupná nebo k ní nemáte oprávnění. Zobrazené počty nejsou počty přihlášených uživatelů. Obnovte přehled.','warning'));
  return;
 }
 const id=docs?'dochazka.employee.public-docs':'dochazka.admin.integrations',title=docs?'Dokumentace integračního API':'Integrace docházky';
 const main=heading(id,title,'Informace o samostatných integračních tokenech s vymezeným oprávněním.');
 const actions=el('div',{class:'actions'},button('Portál zaměstnance',()=>go('attendance')),state.identity.admin?button('Administrace',()=>go('overview')):null);
 const contents=el('div',{},notice('Integrační přístup má vlastní vymezené oprávnění. Přihlašovací relace uživatele není integračním tokenem.'),info([['API namespace','/api/v1/integration'],['Verze kontraktu','Podle aktuálního OpenAPI'],['Autentizace','Samostatný token s vymezenými právy']]),el('div',{class:'integration-routes'},routes.map(([method,path])=>el('code',{},method+' '+path))),el('h3',{},'STRÁNKOVÁNÍ A CHYBY'),el('p',{},'Seznamy používají neprůhledný cursor. Každý požadavek podléhá oprávnění klienta, datovému rozsahu a limitům.'),table(['Kód','Význam'],errors),notice('Stažení OpenAPI vyžaduje vlastní integrační token s oprávněním pro čtení schématu. Použijte svůj integrační klient na GET /api/v1/integration/openapi.json; tato stránka token nesbírá ani nevydává.'),actions);
 main.append(panel(title,contents,'link'));
}
