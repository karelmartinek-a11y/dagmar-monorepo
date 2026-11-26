import {request} from './api.js';
import {node} from './dom.js';

const requested = new URLSearchParams(location.hash.slice(1));
const ticket = requested.get('ticket');
const grant = document.querySelector('#grant');
const allow = document.querySelector('#allow');
const receipt = document.querySelector('#receipt');
const failed = 'Žádost o připojení vypršela nebo ji nelze ověřit. Zahajte připojení v ChatGPT.';

async function call(action) {
  return request('oauth/consent',{method:'POST',data:{ticket,action}});
}

if (requested.size===1 && /^[A-Za-z0-9_-]{43}$/.test(ticket ?? '')) {
  try {
    const scope = await call('inspect');
    if (typeof scope.manage!=='boolean') throw Error();
    grant.textContent = scope.manage ? 'ChatGPT žádá o čtení a změny docházky a plánu služeb.' :
      'ChatGPT žádá o čtení docházky.';
    allow.disabled = false;
  } catch {
    receipt.textContent = failed;
  }
} else receipt.textContent = 'V odkazu chybí žádost o připojení.';

allow.addEventListener('click',async()=>{
  allow.disabled = true;
  receipt.textContent = 'Ověřuji povolení přístupu…';
  try {
    const result = await call('approve');
    const target = new URL(result.redirect);
    if (target.origin!=='https://chatgpt.com' || target.username || target.password) throw Error();
    const resume = node('a','Dokončit připojení v ChatGPT',{href:target.href,target:'_top',rel:'noreferrer'});
    allow.remove();
    receipt.replaceChildren(resume);
    resume.focus();
  } catch {
    receipt.textContent = failed;
  }
});
