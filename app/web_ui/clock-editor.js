// Newly authored editor shared by actual attendance and shift-plan cells.
export function normalizeTime(raw){
 const text=raw.trim();if(!text)return '';
 const match=/^(\d{1,2})$/.exec(text)||/^(\d{1,2})[:.,]?(\d{2})$/.exec(text);
 if(!match)return null;const hour=Number(match[1]),minute=Number(match[2]??0);
 return hour<=23&&minute<=59?String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0'):null;
}
const drafts=new Map();let active=null,replaying=false;
const flash=(input,kind)=>{input.classList.remove('clock-ok','clock-error');void input.offsetWidth;input.classList.add('clock-'+kind);};
function current(label){return [...document.querySelectorAll('input.clock')].find(n=>n.dataset.clock===label);}
export function clockEditor(value,{key,disabled,label,save,state,render,error,el}){
 const original=value??'',draft=drafts.get(label);
 const input=el('input',{class:'clock',type:'text',inputmode:'numeric',value:state.pending.has(key)?original:(draft?.value??original),'aria-label':label,readOnly:disabled||state.pending.has(key)||state.uncertain.has(key),maxlength:5});
 input.dataset.dayKey=key;input.dataset.clock=label;
 let working=null,failed=!!draft?.failed;
 const dirty=()=>input.value!==original;
 const cancel=()=>{if(working)return;input.value=original;failed=false;drafts.delete(label);input.removeAttribute('aria-invalid');input.classList.remove('clock-error');if(active?.input===input)active=null;};
 const reject=message=>{failed=true;drafts.set(label,{value:input.value,failed:true});input.setAttribute('aria-invalid','true');flash(input,'error');error(Error(message));if(input.isConnected)input.focus({preventScroll:true});return false;};
 const commit=next=>{
  if(working)return working;
  if(disabled||state.pending.has(key))return Promise.resolve(false);
  if(state.uncertain.has(key))return Promise.resolve(reject('Výsledek zápisu není ověřený. Stiskněte Escape a obnovte stav.'));
  const normalized=normalizeTime(input.value);
  if(normalized===null)return Promise.resolve(reject('Zadejte platný čas od 0:00 do 23:59.'));
  if(!dirty()&&!failed){flash(input,'ok');if(next)next.focus();return Promise.resolve(true);}
  if(disabled||state.pending.has(key)||state.uncertain.has(key))return Promise.resolve(reject('Zápis není povolen nebo jeho předchozí výsledek není ověřený. Obnovte stav.'));
  drafts.set(label,{value:input.value});state.pending.add(key);
  const peers=[...document.querySelectorAll('input.clock')].filter(n=>n.dataset.dayKey===key);peers.forEach(n=>n.readOnly=true);
  const selected={view:state.view,year:state.year,month:state.month,employment:state.employment,group:state.group};
  const stillCurrent=()=>Object.entries(selected).every(([k,v])=>state[k]===v);
  let accepted=false;working=(async()=>{try{
   await save(normalized||null);accepted=true;if(!stillCurrent()){drafts.delete(label);return true;}
   const focusLabel=active?.input.dataset.clock;state.pending.delete(key);drafts.delete(label);
   await render({propagate:true});
   const saved=current(label);if(saved){flash(saved,'ok');saved.removeAttribute('aria-invalid');}
   if(active?.input===input)active=null;
   if(next){const target=next.dataset?.clock?current(next.dataset.clock):next;target?.isConnected&&target.focus();}else (current(focusLabel)??saved)?.focus({preventScroll:true});
   return true;
  }catch(e){if(accepted||e.uncertain)state.uncertain.add(key);if(!stillCurrent())return false;return reject(accepted?'Zápis byl přijat, ale následné načtení selhalo. Stiskněte Escape a obnovte přehled; zápis neopakujte.':e.message||'Změnu se nepodařilo uložit.');}
  finally{state.pending.delete(key);working=null;peers.forEach(n=>n.readOnly=disabled||state.uncertain.has(key));}})();return working;
 };
 input.addEventListener('focus',()=>{active={input,dirty,commit,cancel,blocked:()=>failed||!!working,invalid:()=>failed};});
 input.addEventListener('input',()=>{drafts.set(label,{value:input.value,failed});});
 input.addEventListener('blur',event=>{if(dirty()||failed)void commit(event.relatedTarget);});
 input.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();cancel();return;}
  if(event.key==='Delete'){event.preventDefault();if(!input.readOnly){input.value='';drafts.set(label,{value:''});}return;}
  if(event.key==='Enter'||event.key==='Tab'){
   event.preventDefault();let next;
   if(event.key==='Tab'){const fields=[...document.querySelectorAll('input.clock')].filter(n=>!n.readOnly);next=fields[fields.indexOf(input)+(event.shiftKey?-1:1)];}
   void commit(next);
  }
 });
 if(failed)input.setAttribute('aria-invalid','true');return input;
}
document.addEventListener('pointerdown',event=>{if(active&&active.input!==event.target&&active.input.isConnected&&(active.dirty()||active.blocked()))event.preventDefault();},true);
document.addEventListener('click',event=>{
 if(replaying||!active||active.input===event.target||!active.input.isConnected)return;
 if(!active.dirty()&&!active.blocked())return;
 event.preventDefault();event.stopImmediatePropagation();const target=event.target.closest('button,a,input,select,textarea,[tabindex]'),editor=active;
 if(editor.queued)return;editor.queued=true;
 const signature=target&&{tag:target.tagName,text:target.textContent,id:target.id,label:target.getAttribute('aria-label')};
 void editor.commit(target).then(ok=>{if(!ok||!signature)return;let destination=target;if(!destination.isConnected){const candidates=[...document.querySelectorAll(signature.tag)].filter(n=>signature.id?n.id===signature.id:n.textContent===signature.text&&n.getAttribute('aria-label')===signature.label);destination=candidates.length===1?candidates[0]:null;}if(destination?.isConnected){replaying=true;try{destination.focus();destination.click();}finally{replaying=false;}}}).finally(()=>editor.queued=false);
},true);
document.addEventListener('focusin',event=>{if(active&&active.input!==event.target&&active.input.isConnected&&active.blocked())active.input.focus({preventScroll:true});},true);

addEventListener('beforeunload',event=>{if(active?.input.isConnected&&(active.dirty()||active.blocked())){event.preventDefault();event.returnValue='';}});

document.addEventListener('focus',event=>{if(active?.input.isConnected&&active.input!==event.target&&active.invalid()){event.stopImmediatePropagation();const previous=active.input;queueMicrotask(()=>previous.isConnected&&previous.focus({preventScroll:true}));}},true);
