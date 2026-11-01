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
 const main=document.querySelector('#content');main.dataset.view=id;main.replaceChildren();const crumb=document.createElement('div');crumb.className='crumb';crumb.textContent='KájovoCML Ng Lite  ›  KájovoDocházka';const label=document.createElement('div');label.className='eyebrow';label.textContent=id;const heading=document.createElement('h1');heading.textContent=title;const p=document.createElement('p');p.className='page-description';p.textContent=description;main.append(crumb,label,heading,p);parent.postMessage({type:'KAJOVO_VIEW',prefix,id,title},location.origin);return main;
}
let preparedDownload=null;
const downloadRetry='Soubor je připravený. Pro stažení klikněte znovu na stejné tlačítko.';
export async function download(path,options={}){
 if(parent!==window){
  const id=options.exportId,limit=id==='attendance-plan-pdf'?50000000:['attendance-csv-zip','attendance-csv'].includes(id)?16*1024*1024:0;
  if(!limit)throw Error('Export nemá deklarovaný formát souboru.');
  const key=JSON.stringify([path,options.method??'GET',options.body??null,id]);
  if(preparedDownload?.key!==key){
   preparedDownload=null;const blob=await api(path,{...options,blob:true});
   if(!blob.size||blob.size>limit)throw Error('Export překračuje povolenou velikost souboru.');
   const signature=new Uint8Array(await (id==='attendance-csv'?blob:blob.slice(0,5)).arrayBuffer());
   if(id==='attendance-plan-pdf'?String.fromCharCode(...signature)!=='%PDF-':id==='attendance-csv'?signature.includes(0):signature[0]!==80||signature[1]!==75||signature[2]!==3||signature[3]!==4)throw Error('Backend nevrátil platný soubor exportu.');
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Soubor nelze připravit ke stažení.'));reader.readAsDataURL(blob);});
   preparedDownload={key,id,base64};
  }
  const prepared=preparedDownload,requestId=crypto.randomUUID(),accepted=await new Promise(resolve=>{
   const finish=value=>{clearTimeout(timer);removeEventListener('message',receive);resolve(value);};
   const receive=event=>{const data=event.data;if(event.source===parent&&event.origin===location.origin&&data?.type==='CML_SECTION_DOWNLOAD_RESULT'&&data.prefix===prefix&&data.requestId===requestId)finish(data.accepted===true);};
   const timer=setTimeout(()=>finish(false),5000);addEventListener('message',receive);
   parent.postMessage({type:'CML_SECTION_DOWNLOAD',prefix,requestId,id,base64:prepared.base64},location.origin);
  });
  if(!accepted)throw Error(downloadRetry);
  const prompt=document.querySelector('#operation-status [role=alert]');if(prompt?.textContent===downloadRetry)prompt.remove();
  if(preparedDownload===prepared)preparedDownload=null;return;
 }
 const blob=await api(path,{...options,blob:true}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=options.filename??'export';a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
