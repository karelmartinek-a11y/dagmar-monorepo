import {t} from './language.js';
import {check,facts,field,node,panel,press,select} from './dom.js';
import {approval,dayText,dialog,hours,states} from './sheets.js';

const all = 'api/v1/admin/employment-groups';
const sorted = values=>values.map(Number).sort((left,right)=>left-right).join(',');

export async function showGroups(context) {
  const {root,state,signal,request,month,guard,render,update} = context;
  if (!state.identity.admin) {
    const toolbar = panel(null,...context.period());
    root.append(toolbar);
    const {groups} = await request('api/v1/shift-plan/groups',{params:month(),signal});
    if (signal.aborted) return;
    const selected = groups.find(item=>item.id===state.group) ?? groups[0];
    if (!selected) {
      root.append(node('p','Pro tento měsíc nemáte přiřazenou skupinu.'));
      return;
    }
    state.group = selected.id;
    const choices = select(groups.map(group=>[group.id,group.name]),state.group);
    choices.addEventListener('change',guard(async()=>{
      state.group = Number(choices.value);
      await render();
    }));
    toolbar.append(field('Skupina',choices));
    const {rows} = await request('api/v1/shift-plan/groups/'+selected.id,{params:month(),signal});
    if (signal.aborted) return;
    const outline = panel('Plán skupiny · '+selected.name);
    for (const row of rows) {
      const sheet = node('details');
      sheet.append(node('summary',row.display_label ?? row.user_name),
        node('p','Plán za měsíc · '+hours(row.summary?.planned_hours ?? row.planned_hours,state.locale)),
        facts(row.days.map(day=>[dayText(day.date,state.locale),
          (day.status ? states.get(day.status) ?? day.status :
            [day.arrival_time,day.departure_time].filter(Boolean).map(value=>String(value).slice(0,5)).join(' – ')) || '—'])));
      outline.append(sheet);
    }
    if (!rows.length) outline.append(node('p','Pro tento měsíc není ve skupině žádný platný úvazek.'));
    root.append(outline);
    return;
  }

  const toolbar = panel(null,...context.period());
  root.append(toolbar);
  const {groups} = await request(all,{signal});
  if (signal.aborted) return;
  toolbar.append(press('Nová skupina',guard(()=>editor(null)),true));
  for (const group of groups) {
    const members = node('ul');
    members.append(...group.members.map(person=>node('li',person.display_label)));
    const actions = node('div',null,{class:'group'});
    actions.append(press('Upravit skupinu',guard(()=>editor(group))),
      press('Odstranit skupinu',()=>approval('Odstranit skupinu '+group.name+'?',
        'Po potvrzení zanikne skupina. Úvazky a jejich evidované směny zůstanou uložené.',
        ()=>update(keyFor(group),async()=>{
          await assertCurrent(group);
          await request(all+'/'+group.id,{method:'DELETE'});
        }))));
    root.append(panel(group.name,members,actions));
  }
  if (!groups.length) root.append(node('p','Zatím není založena žádná skupina.'));

  function keyFor(group) {
    return state.year+':'+state.month+':group:'+(group?.id ?? 'new');
  }
  async function assertCurrent(group) {
    const list = await request(all);
    const current = list.groups.find(row=>row.id===group.id);
    if (!current || current.name!==group.name ||
        sorted(current.members.map(row=>row.employment_id))!==sorted(group.members.map(row=>row.employment_id))) {
      throw Error('Skupina se mezitím změnila. Otevřete uloženou skupinu znovu.');
    }
    return current;
  }

  async function editor(group) {
    const available = await request('api/v1/admin/shift-plan',{params:month(),signal});
    if (signal.aborted) return;
    const prior = new Map((group?.members ?? []).map(row=>[row.employment_id,row.display_label]));
    const options = new Map(available.available_employments.map(row=>[row.id,row.display_label]));
    for (const [id,label] of prior) if (!options.has(id)) options.set(id,label+' · dříve přiřazený úvazek');
    const chosen = [...options].map(([key,label])=>check(label,key,prior.has(key)));
    const form = node('form');
    const name = node('input',null,{type:'text',maxlength:'160',required:''});
    name.value = group?.name ?? '';
    const issue = node('p',null,{role:'status'});
    const submit = node('button','Uložit skupinu',{type:'submit',class:'primary'});
    const id = keyFor(group);
    submit.disabled = state.unconfirmed.has(id);
    form.append(field('Název skupiny',name),...chosen.map(row=>row.box),issue,submit);
    const box = dialog(group?'Upravit skupinu':'Nová skupina',form,'Zrušit');
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (submit.disabled) return;
      const label = name.value.trim();
      const members = chosen.filter(row=>row.input.checked).map(row=>Number(row.input.value));
      if (!label || members.length<2) {
        issue.textContent = t('Zadejte název a vyberte alespoň dva úvazky.');
        return;
      }
      submit.disabled = true;
      try {
        await update(id,async()=>{
          if (!group) {
            await request(all,{method:'POST',data:{name:label,employment_ids:members}});
            return;
          }
          await assertCurrent(group);
          let renamed = false;
          if (label!==group.name) {
            await request(all+'/'+group.id,{method:'PUT',data:{name:label}});
            renamed = true;
          }
          if (sorted(members)!==sorted([...prior.keys()])) {
            try {
              await request(all+'/'+group.id+'/members',{method:'PUT',data:{employment_ids:members}});
            } catch(error) {
              if (renamed) error.uncertain = true;
              throw error;
            }
          }
        });
        box.close();
      } catch(error) {
        issue.textContent = t(error.message);
        submit.disabled = state.unconfirmed.has(id);
      }
    });
  }
}
