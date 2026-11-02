import {t,locale} from './i18n.js';
import {el,icon,button,table,panel,notice} from './ui.js';
import {api} from './api.js';

const routes=[['GET','/health',t('Stav integračního klienta')],['GET','/openapi.json',t('Chráněný kontrakt API')],['GET','/employments',t('Přidělené úvazky')],['GET','/attendance-events',t('Chronologické průchody')],['POST','/attendance-events',t('Vytvoření průchodu')],['PATCH','/attendance-events/{event_id}',t('Úprava průchodu')],['DELETE','/attendance-events/{event_id}',t('Odstranění průchodu')],['GET','/locks',t('Měsíční zámky')]];
const errors=[['400',t('Neplatný vstup')],['401',t('Neplatný nebo chybějící token')],['403',t('Nedostatečná oprávnění')],['409',t('Konflikt změny')],['423',t('Zamčené období')],['429',t('Překročený limit')]];
const info=items=>el('div',{class:'admin-info-grid'},items.map(([label,value])=>el('div',{class:'admin-info-item'},el('small',{},label),el('strong',{},value))));
const card=(key,title,value,detail,ico)=>el('section',{class:'admin-stat','data-stat':key},el('div',{class:'admin-stat-label'},el('span',{},title),icon(ico)),el('strong',{class:'admin-stat-value'},value),el('p',{},detail));

export async function adminInfo({state,heading,render}){
 const generation=state.generation,docs=state.view==='public-docs';
 if(!docs&&!state.identity.admin)throw Error(t('Tento přehled vyžaduje přístup správce docházky.'));
 const go=view=>{state.view=view;render();};
 if(state.view==='overview'){
  const main=heading('dochazka.admin.overview',t('Docházka · přehled správce'),t('Rychlý provozní rozcestník a orientační souhrn počtů.'));
  const statistics=el('div',{class:'admin-statistics','aria-live':'polite'},card('users',t('Uživatelé: celkem'),t('Načítání'),t('Načítání aktivních uživatelů'),'users'),card('clients',t('Integrační klienti'),t('Načítání'),t('Načítání aktivních klientů'),'link'),card('health',t('Systém odpovídá'),t('Načítání'),t('Ověřování dostupnosti služby'),'shield'));
  const quick=(view,title,description,ico)=>el('button',{type:'button',class:'admin-quick','aria-label':title,onclick:()=>go(view)},icon(ico),el('span',{},el('strong',{},title),el('small',{},description)));
  const environment=el('div',{},notice(t('Načítání informací o prostředí…')));
  main.append(statistics,panel(t('Provozní agendy'),el('div',{class:'admin-quick-grid'},quick('attendance',t('Docházkové listy'),t('Skutečné průchody a měsíční zámky'),'attendance'),quick('plan',t('Plán služeb'),t('Plánování směn a nepřítomností'),'calendar'),quick('export',t('Export a uzávěrka'),t('CSV a ZIP za vybrané úvazky'),'export')),'clock'),panel(t('Informace o prostředí'),environment,'info'),button(t('Obnovit přehled'),render));
  const list=(path,key)=>api(path).then(value=>{const rows=key?value[key]:value;if(!Array.isArray(rows))throw Error(t('Neplatná odpověď přehledu.'));return rows;});
  const [users,clients,version,health]=await Promise.allSettled([list('api/v1/admin/users','users'),list('api/v1/admin/integrations/clients'),api('api/version'),api('api/v1/health')]);
  if(generation!==state.generation)return;
  const available=result=>result.status==='fulfilled',count=(result,predicate)=>available(result)?(predicate?result.value.filter(predicate).length:result.value.length):'N/A';
  statistics.replaceChildren(card('users',t('Uživatelé: celkem'),count(users),t('Aktivní uživatelé: ')+count(users,row=>row.is_active===true),'users'),card('clients',t('Integrační klienti'),count(clients),t('Aktivní klienti: ')+count(clients,row=>row.status==='ACTIVE'),'link'),card('health',t('Systém odpovídá'),available(health)&&health.value.ok===true?t('Ano'):t('Nedostupné'),t('Dostupnost služby ověřená požadavkem'),'shield'));
  environment.replaceChildren(info([[t('Prostředí'),available(version)?version.value.environment:'N/A'],[t('Verze backendu'),available(version)?version.value.backend_deploy_tag:'N/A'],[t('Datová autorita'),t('Docházková služba')],[t('Časové pásmo'),'Europe/Prague'],[t('API namespace'),'/api/v1'],[t('Správa účtů a úvazků'),t('Centrální Správa uživatelů')]]));
  if([users,clients,version,health].some(result=>!available(result)))main.append(notice(t('Část dat není dostupná nebo k ní nemáte oprávnění. Zobrazené počty nejsou počty přihlášených uživatelů. Obnovte přehled.'),'warning'));
  return;
 }
 const id=docs?'dochazka.employee.public-docs':'dochazka.admin.integrations',title=docs?t('Dokumentace integračního API'):t('Integrace docházky');
 const main=heading(id,title,t('Informace o samostatných integračních tokenech s vymezeným oprávněním.'));
 const actions=el('div',{class:'actions'},button(t('Portál zaměstnance'),()=>go('attendance')),state.identity.admin?button(t('Administrace'),()=>go('overview')):null);
 const contents=el('div',{},notice(t('Integrační přístup má vlastní vymezené oprávnění. Přihlašovací relace uživatele není integračním tokenem.')),info([[t('API namespace'),'/api/v1/integration'],[t('Verze kontraktu'),t('Podle aktuálního OpenAPI')],[t('Autentizace'),t('Samostatný token s vymezenými právy')]]),el('div',{class:'integration-routes'},routes.map(([method,path])=>el('code',{},method+' '+path))),el('h3',{},t('STRÁNKOVÁNÍ A CHYBY')),el('p',{},t('Seznamy používají neprůhledný cursor. Každý požadavek podléhá oprávnění klienta, datovému rozsahu a limitům.')),table([t('Kód'),t('Význam')],errors),notice(t('Stažení OpenAPI vyžaduje vlastní integrační token s oprávněním pro čtení schématu. Použijte svůj integrační klient na GET /api/v1/integration/openapi.json; tato stránka token nesbírá ani nevydává.')),actions);
 main.append(panel(title,contents,'link'));
}
