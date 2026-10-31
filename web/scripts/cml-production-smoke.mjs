import assert from 'node:assert/strict';
import {chromium,request} from '@playwright/test';

const origin=process.env.DAGMAR_PRODUCTION_URL,commit=process.env.DAGMAR_EXPECTED_COMMIT;
assert.equal(origin,'https://dagmar.hcasc.cz');
assert.match(commit??'',/^[0-9a-f]{7}$/);
const http=await request.newContext(),browser=await chromium.launch({headless:true});
try{
 for(const path of ['/','/login','/frontend-version.json']){
  const response=await http.get(origin+path,{maxRedirects:0});assert.equal(response.status(),302);
  assert.equal(response.headers().location,'https://kajovocml.hcasc.cz/#dochazka');
  assert.equal(response.headers()['cache-control'],'no-store');
 }
 const version=await http.get(origin+'/api/version',{maxRedirects:0});assert.equal(version.status(),200);assert.equal((await version.json()).backend_deploy_tag,commit);
 const readiness=await http.get(origin+'/api/v1/readiness',{maxRedirects:0});assert.equal(readiness.status(),200);assert.equal((await readiness.json()).ok,true);
 const unsigned=await http.get(origin+'/cml-web/identity',{maxRedirects:0});assert.equal(unsigned.status(),401);
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin,{waitUntil:'networkidle'});assert.equal(new URL(page.url()).origin,'https://kajovocml.hcasc.cz');
 await page.getByRole('button',{name:'Přihlásit se',exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',legacyBrowserRedirect:true,sourceCommit:commit,backendReadiness:true,unsignedNativeEntryDenied:true,actualCentralLoginPage:true,authenticatedUiAcceptance:'separate CML release gate',businessWrites:0}));
}finally{await browser.close();await http.dispose();}
