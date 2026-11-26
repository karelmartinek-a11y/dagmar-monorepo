export const prefix = '/sections/dochazka/';
const token = name=>document.querySelector('meta[name="'+name+'"]')?.content ?? '';

export function path(route,params = {}) {
  const query = new URLSearchParams(params);
  return prefix+route+(query.size ? '?'+query : '');
}

export async function request(route,{params,method='GET',data,signal,media} = {}) {
  const headers = {'X-CML-Section-Capability':token('cml-section-capability'),Accept:media ?? 'application/json'};
  if (method!=='GET') headers['X-CSRF-Token'] = token('cml-section-csrf');
  if (data!==undefined) headers['Content-Type'] = 'application/json';
  let result;
  try {
    result = await fetch(path(route,params),{method,headers,credentials:'omit',
      body:data===undefined ? undefined : JSON.stringify(data),
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)});
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = Error(method==='GET' ? 'Přehled se nepodařilo načíst.' :
      'Výsledek změny zatím není ověřený. Načtěte uložený stav.');
    failure.uncertain = method!=='GET';
    throw failure;
  }
  if (!result.ok) {
    const failure = await result.json().catch(()=>({}));
    const message = failure.error?.message ?? failure.detail?.message ??
      (typeof failure.detail==='string' ? failure.detail : null) ??
      (result.status===403 ? 'Pro tento požadavek nemáte oprávnění.' : 'Služba nepotvrdila výsledek.');
    const error = Error(message);
    error.status = result.status;
    error.uncertain = method!=='GET' && result.status>=500;
    throw error;
  }
  if (result.status===204) return null;
  if (media) return result.blob();
  return result.json();
}
