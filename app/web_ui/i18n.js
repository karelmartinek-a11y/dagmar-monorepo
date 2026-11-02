import {translations} from './translations.js';
const languages=['cs','en','sk','de','hi'];
const requested=new URLSearchParams(globalThis.location?.search??'').get('lang');
export const locale=languages.includes(requested)?requested:'cs';
export const t=text=>locale==='cs'?text:(translations[text]?.[languages.indexOf(locale)-1]??text);
if(globalThis.document)document.documentElement.lang=locale;
const prefix='/sections/dochazka/';
function exchange(type,value){
 if(parent===window)return Promise.resolve(null);
 return new Promise(resolve=>{const requestId=crypto.randomUUID();let timer;
  const finish=value=>{clearTimeout(timer);removeEventListener('message',receive);resolve(value);};
  const receive=event=>{const d=event.data;if(event.source===parent&&event.origin===location.origin&&d?.type==='CML_SECTION_STATE_RESULT'&&d.prefix===prefix&&d.requestId===requestId&&d.key==='locale')finish(d.ok?d.value:null);};
  addEventListener('message',receive);timer=setTimeout(()=>finish(null),2000);
  parent.postMessage({type,prefix,requestId,key:'locale',...(value===undefined?{}:{value})},location.origin);
 });
}
export async function restoreLocale(allowed){
 const selected=requested??await exchange('CML_SECTION_STATE_READ');
 const valid=allowed.includes(selected)?selected:'cs';
 if(valid===locale)return false;
 const url=new URL(location.href);url.searchParams.set('lang',valid);location.replace(url);return true;
}
export function languageSelector(allowed){
 const label=document.createElement('label');label.className='native-language';
 const caption=document.createElement('span');caption.textContent=t('Jazyk');label.append(caption);
 const select=document.createElement('select');select.name='locale';select.setAttribute('aria-label',t('Jazyk'));
 const names={cs:'Čeština',en:'English',sk:'Slovenčina',de:'Deutsch',hi:'हिन्दी'};
 for(const value of languages.filter(v=>allowed.includes(v))){const option=document.createElement('option');option.value=value;option.textContent=names[value];option.selected=value===locale;select.append(option);}
 select.addEventListener('change',async()=>{select.disabled=true;await exchange('CML_SECTION_STATE_WRITE',select.value);const url=new URL(location.href);url.searchParams.set('lang',select.value);location.assign(url);});
 label.append(select);return label;
}
