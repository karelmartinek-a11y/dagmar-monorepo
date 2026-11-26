import {request} from './api.js';
import {field,node,press,select} from './dom.js';
import {showSheet} from './sheets.js';
import {showGroups} from './groups.js';
import {showReports} from './reports.js';
import {showInfo} from './info.js';
import {t,useLanguage} from './language.js';

const property = new URLSearchParams(location.search);
const prague = new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'numeric',timeZone:'Europe/Prague'});
const parts = Object.fromEntries(prague.formatToParts(new Date()).map(part=>[part.type,part.value]));
const state = {
  year:Number(parts.year),month:Number(parts.month),view:'attendance',employment:null,group:null,
  locale:'cs',identity:null,pending:new Set(),unconfirmed:new Set(),
};
const root = document.querySelector('#workspace');
const output = document.querySelector('#notice');
const nav = document.querySelector('nav');
const choices = document.querySelector('#sections');
const locales = new Map([['cs','Čeština'],['en','English'],['sk','Slovenčina'],['de','Deutsch'],['hi','हिन्दी']]);
let manifest;
let renderController;

const translated = (entry,loc)=>entry.localizations?.[loc]?.title ?? entry.title;
const viewId = entry=>new URL(entry.path,location.origin).searchParams.get('view');

function notify(value) {
  output.textContent = t(value ?? '');
}
function guard(task) {
  return async (...args)=>{
    try {
      await task(...args);
    } catch (error) {
      if (error.name!=='AbortError') notify(error.message);
    }
  };
}
function month() {
  return {year:state.year,month:state.month};
}
function setPeriod(delta) {
  const turn = new Date(Date.UTC(state.year,state.month-1+delta,15));
  state.year = turn.getUTCFullYear();
  state.month = turn.getUTCMonth()+1;
  state.employment = null;
  return render();
}

function periodBar() {
  const calendar = new Intl.DateTimeFormat(state.locale,{timeZone:'Europe/Prague',year:'numeric',month:'long'});
  const label = calendar.format(new Date(Date.UTC(state.year,state.month-1,15,12)));
  const previous = press('‹',guard(()=>setPeriod(-1)));
  previous.setAttribute('aria-label',t('Předchozí měsíc'));
  const next = press('›',guard(()=>setPeriod(1)));
  next.setAttribute('aria-label',t('Další měsíc'));
  const pane = node('div',null,{class:'month'});
  pane.append(previous,node('strong',label),next);
  const refresh = press('Obnovit',guard(async()=>{
    await render();
    const prefix = state.year+':'+state.month+':';
    const verified = [...state.unconfirmed].filter(key=>key.startsWith(prefix));
    if (verified.length) {
      for (const key of verified) state.unconfirmed.delete(key);
      await render();
    }
  }));
  return [pane,refresh];
}

async function update(context,key,task,focus) {
  if (state.pending.has(key)||state.unconfirmed.has(key)) {
    throw Error('Nejdřív ověřte původní změnu tohoto záznamu.');
  }
  state.pending.add(key);
  let submitted = false;
  try {
    await task();
    submitted = true;
    if (context.signal.aborted) {
      state.unconfirmed.add(key);
      return;
    }
    state.pending.delete(key);
    await render({anchor:focus,keepScroll:true});
    notify('Zobrazený stav je načtený ze služby.');
  } catch (error) {
    if (submitted || error.uncertain) {
      state.unconfirmed.add(key);
      const unresolved = Error('Výsledek změny vyžaduje nové načtení uloženého stavu.');
      unresolved.uncertain = true;
      throw unresolved;
    }
    throw error;
  } finally {
    state.pending.delete(key);
  }
}

function redrawMenu() {
  const entries = manifest.views.filter(entry=>entry.navigation!==false);
  nav.replaceChildren(...entries.map(entry=>{
    const page = viewId(entry);
    const control = press(translated(entry,state.locale),guard(async()=>{
      state.view = page;
      state.employment = null;
      choices.open = false;
      await render();
    }));
    if(page===state.view) control.setAttribute('aria-current','page');
    return control;
  }));
}

async function render(options = {}) {
  renderController?.abort();
  const controller = renderController = new AbortController();
  const {signal} = controller;
  const active = manifest.views.find(entry=>viewId(entry)===state.view);
  if (!active) throw Error('Požadovanou agendu aktuální účet nemá k dispozici.');
  redrawMenu();
  choices.querySelector('summary').textContent = t('Agendy');
  const scroll = window.scrollY;
  root.replaceChildren(node('h1',translated(active,state.locale),{tabindex:'-1'}));
  document.title = translated(active,state.locale)+' · KájovoDocházka';
  notify();
  const context = {
    state, root, signal, month, guard, notify, request, render,
    period:periodBar,
    go:async page=>{state.view=page;await render();},
    update:(key,task,focus)=>update(context,key,task,focus),
  };
  if (['attendance','plan'].includes(state.view)) await showSheet(context,state.view);
  else if (state.view==='groups') await showGroups(context);
  else if (['prints','export','print-plan','print-summary'].includes(state.view)) await showReports(context);
  else await showInfo(context);
  if (signal.aborted) return;
  if (options.keepScroll) window.scrollTo(0,scroll);
  else window.scrollTo(0,0);
  if (options.anchor) {
    [...root.querySelectorAll('[data-clock]')].find(control=>control.dataset.clock===options.anchor)?.focus({preventScroll:true});
  } else root.querySelector('h1')?.focus({preventScroll:true});
}

function setLanguage() {
  document.documentElement.lang = state.locale;
  useLanguage(state.locale);
  nav.setAttribute('aria-label',t('Agendy'));
}

void guard(async()=>{
  [state.identity,manifest] = await Promise.all([request('identity'),request('ui-manifest.json')]);
  const languages = state.identity.languages.filter(id=>locales.has(id));
  state.locale = languages.includes(property.get('lang')) ? property.get('lang') : languages[0] ?? 'cs';
  setLanguage();
  const language = select(languages.map(value=>[value,locales.get(value)]),state.locale);
  if (languages.length>1) {
    const widget = field('Jazyk',language);
    language.addEventListener('change',guard(async()=>{
      state.locale = language.value;
      setLanguage();
      language.setAttribute('aria-label',t('Jazyk'));
      widget.firstChild.textContent = t('Jazyk');
      await render();
    }));
    root.before(widget);
  }
  const requested = property.get('view')==='group-plan' && !state.identity.admin ? 'groups' : property.get('view');
  state.view = manifest.views.some(entry=>viewId(entry)===requested) ? requested : 'attendance';
  await render();
})();
