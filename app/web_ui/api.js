export const prefix='/sections/dochazka/';
let role=null;
export const setRole=v=>role=v;
export async function api(path,{method='GET',body,blob=false}={}){
 const target=new URL(prefix+path,location.origin);if(role)target.searchParams.set('_role',role);
 let r;try{r=await fetch(target,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});}catch{const e=Error(method==='GET'?'Data nejsou dostupná.':'Výsledek zápisu není ověřený. Obnovte stav před dalším pokusem.');e.uncertain=method!=='GET';throw e;}
 if(!r.ok){let data;try{data=await r.json();}catch{}const err=Error(data?.error?.message??data?.detail?.message??(typeof data?.detail==='string'?data.detail:null)??'Požadavek nebyl povolen nebo se nepodařil.');err.status=r.status;err.code=data?.error?.code;err.uncertain=method!=='GET'&&r.status>=500;throw err;}
 if(r.status===204)return null;return blob?r.blob():r.json();
}
export function view(id,title,description){
 const main=document.querySelector('#content');main.dataset.view=id;main.replaceChildren();const crumb=document.createElement('div');crumb.className='crumb';crumb.textContent='KájovoCML Ng Lite  ›  KájovoDocházka';const label=document.createElement('div');label.className='eyebrow';label.textContent=id;const heading=document.createElement('h1');heading.textContent=title;const p=document.createElement('p');p.className='page-description';p.textContent=description;main.append(crumb,label,heading,p);parent.postMessage({type:'KAJOVO_VIEW',prefix,id},location.origin);return main;
}
export async function download(path,options={}){const blob=await api(path,{...options,blob:true}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=options.filename??'export';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
