import {facts,node,panel,press} from './dom.js';

const supported = [
  ['GET /health','Dostupnost integrační služby'],
  ['GET /openapi.json','Aktuální schéma kontraktu'],
  ['GET /employments','Výpis přidělených úvazků'],
  ['GET /attendance-events','Uložené průchody'],
  ['POST /attendance-events','Vytvoření průchodu'],
  ['PATCH /attendance-events/{event_id}','Úprava průchodu'],
  ['DELETE /attendance-events/{event_id}','Odstranění průchodu'],
  ['GET /locks','Zámky období'],
];
const statuses = [['400','Neplatný požadavek'],['401','Neplatné přihlášení integračního klienta'],['403','Zamítnuté oprávnění'],
  ['409','Konflikt hodnot nebo revize'],['423','Uzamčené období'],['429','Příliš mnoho požadavků']];

export async function showInfo(context) {
  const {state,root,request,signal,go,render,guard} = context;
  if (state.view!=='overview') {
    root.append(panel('Rozhraní /api/v1/integration',
      node('p','Integrační klient používá vlastní token s omezeným rozsahem oprávnění.'),
      facts(supported),node('h3','Výsledky a chyby'),facts(statuses),
      node('p','Seznamy používají průběžný cursor. Schéma OpenAPI získá oprávněný klient na cestě GET /api/v1/integration/openapi.json.'),
      press('Docházka',guard(()=>go('attendance')))));
    if (state.identity.admin) root.append(press('Přehled správce',guard(()=>go('overview'))));
    return;
  }
  root.append(press('Obnovit přehled',guard(()=>render())));
  const links = node('div',null,{class:'group'});
  for (const [id,label] of [['attendance','Docházkové listy'],['plan','Plán služeb'],['export','Export a uzávěrka']]) {
    links.append(press(label,guard(()=>go(id))));
  }
  const readout = panel('Provozní stav',node('p','Načítám souhrn…'));
  root.append(readout,panel('Provozní agendy',links));
  const outcomes = await Promise.allSettled([
    request('api/v1/admin/users',{signal}),request('api/v1/admin/integrations/clients',{signal}),
    request('api/version',{signal}),request('api/v1/health',{signal}),
  ]);
  if (signal.aborted) return;
  const [users,clients,version,health] = outcomes.map(outcome=>outcome.status==='fulfilled'?outcome.value:null);
  const list = users?.users;
  readout.replaceChildren(node('h2','Provozní stav'),facts([
    ['Uživatelé celkem',list?.length ?? 'Nedostupné'],['Aktivní uživatelé',list?.filter(row=>row.is_active).length ?? 'Nedostupné'],
    ['Integrační klienti',clients?.length ?? 'Nedostupné'],
    ['Aktivní klienti',clients?.filter(row=>row.status==='ACTIVE').length ?? 'Nedostupné'],
    ['Dostupnost služby',health?.ok===true?'Odpovídá':'Nedostupné'],
    ['Prostředí',version?.environment ?? 'Nedostupné'],['Verze backendu',version?.backend_deploy_tag ?? 'Nedostupné'],
    ['Časové pásmo','Europe/Prague'],['Správa účtů a úvazků','Správa uživatelů v KájovoCML'],
  ]));
  if (outcomes.some(item=>item.status==='rejected')) readout.append(node('p','Některý provozní údaj se nepodařilo načíst.'));
}
