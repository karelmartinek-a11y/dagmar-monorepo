import {t} from './language.js';

export function node(tag,text,attrs = {}) {
  const item = document.createElement(tag);
  if (text!=null) item.textContent = t(text);
  for (const [key,value] of Object.entries(attrs)) item.setAttribute(key,key==='aria-label'?t(value):value);
  return item;
}
export function press(text,action,primary = false) {
  const item = node('button',text,{type:'button'});
  if (primary) item.className = 'primary';
  item.addEventListener('click',action);
  return item;
}
export function field(text,control) {
  const wrapper = node('label',text);
  control.setAttribute('aria-label',t(text));
  wrapper.append(control);
  return wrapper;
}
export function select(rows,value) {
  const control = node('select');
  for (const [key,name] of rows) control.append(node('option',name,{value:key}));
  if (value!=null) control.value = String(value);
  return control;
}
export function facts(pairs) {
  const description = node('dl');
  for (const [key,value] of pairs) {
    if (value!=null && value!=='') description.append(node('dt',key),node('dd',String(value)));
  }
  return description;
}
export function panel(title,...items) {
  const area = node('section',null,{class:'card'});
  if (title) area.append(node('h2',title));
  area.append(...items);
  return area;
}
export function check(label,value,checked = false) {
  const box = node('label',null,{class:'check'});
  const input = node('input',null,{type:'checkbox',value});
  input.checked = checked;
  box.append(input,node('span',label));
  return {box,input};
}
