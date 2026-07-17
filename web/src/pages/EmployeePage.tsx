import { FormEvent, KeyboardEvent, ReactNode, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, CalendarClock, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Contrast, LogOut, MoreVertical, Plane, TimerReset, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import type { AttendanceDay, PortalSession } from "../api/types";
import { Brand } from "../components/Brand";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Button, Field, Modal, StatusMessage } from "../components/Primitives";
import { useCurrentLanguage, useDateFormatter } from "../utils/format";
import { asPragueDate, getCalendarDayTone, getDayMeta } from "../utils/calendar";
import { clearPortalSession, loadPortalSession, savePortalLogin, selectEmployment } from "../state/portalSession";
import { flushOperations, listOperations, queueOperation } from "../state/offlineQueue";
import { normalizeTimeInput } from "../utils/timeInput";

const pragueDateTime = new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Prague", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false });
const durationMinutes=(start:string|null,end:string|null)=>{if(!start||!end)return 0;const[sh,sm]=start.split(":").map(Number);const[eh,em]=end.split(":").map(Number);return Math.max(0,eh*60+em-(sh*60+sm))};
const dayMinutes=(day:AttendanceDay)=>durationMinutes(day.arrival_time,day.departure_time)+durationMinutes(day.arrival_time_2??null,day.departure_time_2??null);
const themeKey = "kajovodagmar.employee.theme.v1";

function hoursLabel(minutes:number,t:(key:string, options?: Record<string, unknown>)=>string){return t("employee.units.hoursMinutes",{hours:Math.floor(minutes/60),minutes:minutes%60});}
function shortHoursLabel(minutes:number,t:(key:string, options?: Record<string, unknown>)=>string){return t("employee.units.shortHours",{hours:Math.floor(minutes/60),minutes:String(minutes%60).padStart(2,"0")});}

function EmployeeLogin({ onLogin }: { onLogin:(session:PortalSession)=>void }) {
  const { t } = useTranslation();
  const [email,setEmail]=useState("");const[password,setPassword]=useState("");const[error,setError]=useState("");const[pending,setPending]=useState(false);
  const submit=async(e:FormEvent)=>{e.preventDefault();setPending(true);setError("");try{onLogin(savePortalLogin(await api.portalLogin(email,password)))}catch(err){setError(err instanceof Error?err.message:t("employee.login.fallbackError"))}finally{setPending(false)}};
  return <main className="auth-page"><section className="auth-story"><div className="auth-story__top"><Brand/><LanguageSwitcher /></div><div><h1>{t("employee.login.heroTitleLead")}<span>{t("employee.login.heroTitleAccent")}</span></h1><p>{t("employee.login.heroDescription")}</p></div><small>{t("employee.login.heroFooter")}</small></section><section className="auth-board"><div className="auth-card"><h2>{t("employee.login.title")}</h2><p>{t("employee.login.description")}</p><form onSubmit={submit}><Field label={t("employee.login.email")}><input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label={t("employee.login.password")}><input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></Field>{error&&<StatusMessage kind="error" title={t("employee.login.errorTitle")}>{error}</StatusMessage>}<Button disabled={pending}>{pending?t("employee.login.submitting"):t("employee.login.submit")}</Button></form></div></section></main>;
}

type TimeField="arrival_time"|"departure_time"|"arrival_time_2"|"departure_time_2";
type TimeValues=Record<TimeField,string>;
const timeFields: TimeField[] = ["arrival_time","departure_time","arrival_time_2","departure_time_2"];
type PlanField="planned_arrival_time"|"planned_departure_time";
type PlanValues=Record<PlanField,string>;
type EditSession<Field extends string> = { field: Field; originalValue: string; revertOnEscape: boolean };

function pragueNowParts(): { date: string; time: string } {
  const parts = Object.fromEntries(pragueDateTime.formatToParts(new Date()).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function dayToValues(day: AttendanceDay): TimeValues {
  return { arrival_time:day.arrival_time??"", departure_time:day.departure_time??"", arrival_time_2:day.arrival_time_2??"", departure_time_2:day.departure_time_2??"" };
}

function nextEmptyTimeField(day: AttendanceDay): TimeField | null {
  const values = dayToValues(day);
  return timeFields.find(field => !values[field]) ?? null;
}

function DayCard({ day, attendanceLocked, savedField, onSave, onStatus }: { day:AttendanceDay;attendanceLocked:boolean;savedField:TimeField|null;onSave:(day:AttendanceDay,values:TimeValues,field:TimeField)=>void;onStatus:(day:AttendanceDay,status:string,confirmed?:boolean)=>void }) {
  const { t } = useTranslation();
  const language = useCurrentLanguage();
  const dayName = useDateFormatter({ weekday:"long" });
  const fullDate = useDateFormatter({ day:"numeric", month:"long" });
  const shortDate = useDateFormatter({ day:"2-digit", month:"2-digit", year:"numeric" });
  const statusLabels:Record<string,string>={HOLIDAY:t("employee.statuses.HOLIDAY"),OFF:t("employee.statuses.OFF")};
  const initial=():TimeValues=>dayToValues(day);
  const [values,setValues]=useState<TimeValues>(initial);const[editing,setEditing]=useState<TimeField|null>(null);const[editSession,setEditSession]=useState<EditSession<TimeField>|null>(null);const[statusOpen,setStatusOpen]=useState(false);const[invalid,setInvalid]=useState<TimeField|null>(null);
  useEffect(()=>{setValues(dayToValues(day));setEditing(null);setEditSession(null);setInvalid(null)},[day]);
  const date=asPragueDate(day.date);const hasWholeDayStatus=day.planned_status==="HOLIDAY"||day.planned_status==="OFF";const disabled=attendanceLocked||!day.is_within_employment_period||hasWholeDayStatus;
  const mobileSecondPass=Boolean(values.arrival_time_2||values.departure_time_2);
  const isDirty=(next:TimeValues)=>Object.entries(next).some(([key,value])=>value!==((day as unknown as Record<string,string|null>)[key]??""));
  const save=(next:TimeValues,field:TimeField)=>{if(!isDirty(next)||invalid)return;onSave(day,next,field)};
  const enterEdit=(field:TimeField)=>{if(disabled)return;setEditing(current=>current??field);setEditSession(current=>current?.field===field?current:{field,originalValue:values[field],revertOnEscape:false});setInvalid(null)};
  const commit=(field:TimeField)=>{const normalized=normalizeTimeInput(values[field]);if(normalized===null){setInvalid(field);return null}const next={...values,[field]:normalized};setValues(next);setInvalid(null);return next};
  const finish=(field:TimeField,next:TimeValues)=>{setEditing(null);setEditSession(null);save(next,field)};
  const blur=(field:TimeField)=>{const next=commit(field);if(next)finish(field,next)};
  const key=(event:KeyboardEvent<HTMLInputElement>,field:TimeField)=>{
    if(event.key==="Delete"||event.key==="Backspace"){
      if(editing!==field){event.preventDefault();enterEdit(field);return}
      if(values[field]&&editSession?.field===field&&!editSession.revertOnEscape&&values[field]===editSession.originalValue){
        event.preventDefault();
        setValues(current=>({...current,[field]:""}));
        setEditSession(current=>current&&current.field===field?{...current,revertOnEscape:true}:current);
        setInvalid(null);
      }
      return;
    }
    if(event.key==="Escape"){
      event.preventDefault();
      if(editSession?.field===field&&editSession.revertOnEscape){
        setValues(current=>({...current,[field]:editSession.originalValue}));
        setEditing(null);
        setEditSession(null);
        setInvalid(null);
        return;
      }
      const next=commit(field);
      if(next)finish(field,next);
      return;
    }
    if(event.key!=="Enter")return;
    if(editing!==field){event.preventDefault();enterEdit(field);return}
    event.preventDefault();
    const next=commit(field);
    if(next)finish(field,next);
  };
  const setStatus=(status:string)=>{setStatusOpen(false);onStatus(day,status,true)};
  const change=(field:TimeField,value:string)=>{setValues(current=>({...current,[field]:value}));setEditSession(current=>current?.field===field&&current.revertOnEscape?{...current,revertOnEscape:false}:current)};
  return <article className={`ledger-day employee-day employee-day--${day.planned_status?.toLowerCase()??"work"} employee-day--${getCalendarDayTone(date)} ${!day.is_within_employment_period?"ledger-day--outside":""}`}><div className="employee-day__date"><strong>{shortDate.format(date)}</strong><span>{dayName.format(date)}</span><small>{getDayMeta(date, language)}</small></div><TimeCell field="arrival_time" label={t("employee.dayCard.arrival1")} planned={day.planned_arrival_time} value={values.arrival_time} editing={editing==="arrival_time"} invalid={invalid==="arrival_time"} saved={savedField==="arrival_time"} disabled={disabled} mobileHidden={mobileSecondPass} onEdit={()=>enterEdit("arrival_time")} onChange={value=>change("arrival_time",value)} onBlur={()=>blur("arrival_time")} onKeyDown={event=>key(event,"arrival_time")}/><TimeCell field="departure_time" label={t("employee.dayCard.departure1")} planned={day.planned_departure_time} value={values.departure_time} editing={editing==="departure_time"} invalid={invalid==="departure_time"} saved={savedField==="departure_time"} disabled={disabled} mobileHidden={mobileSecondPass} onEdit={()=>enterEdit("departure_time")} onChange={value=>change("departure_time",value)} onBlur={()=>blur("departure_time")} onKeyDown={event=>key(event,"departure_time")}/><TimeCell field="arrival_time_2" label={t("employee.dayCard.arrival2")} planned={null} value={values.arrival_time_2} editing={editing==="arrival_time_2"} invalid={invalid==="arrival_time_2"} saved={savedField==="arrival_time_2"} disabled={disabled} mobileHidden={!mobileSecondPass} onEdit={()=>enterEdit("arrival_time_2")} onChange={value=>change("arrival_time_2",value)} onBlur={()=>blur("arrival_time_2")} onKeyDown={event=>key(event,"arrival_time_2")}/><TimeCell field="departure_time_2" label={t("employee.dayCard.departure2")} planned={null} value={values.departure_time_2} editing={editing==="departure_time_2"} invalid={invalid==="departure_time_2"} saved={savedField==="departure_time_2"} disabled={disabled} mobileHidden={!mobileSecondPass} onEdit={()=>enterEdit("departure_time_2")} onChange={value=>change("departure_time_2",value)} onBlur={()=>blur("departure_time_2")} onKeyDown={event=>key(event,"departure_time_2")}/><div className="employee-day__status"><button type="button" className="icon-button" disabled={attendanceLocked||!day.is_within_employment_period} aria-label={`${fullDate.format(date)} ${t("employee.dayCard.wholeDayAbsence")}`} title={t("employee.dayCard.wholeDayAbsence")} onClick={()=>setStatusOpen(open=>!open)}><MoreVertical/></button>{statusOpen&&<div className="absence-menu"><button type="button" onClick={()=>setStatus("")}>{t("employee.dayCard.workday")}</button><button type="button" onClick={()=>setStatus("HOLIDAY")}>{t("employee.dayCard.holiday")}</button><button type="button" onClick={()=>setStatus("OFF")}>{t("employee.dayCard.off")}</button></div>}{day.planned_status&&<small>{statusLabels[day.planned_status]??day.planned_status}</small>}</div></article>;
}

function PlanDayCard({ day, shiftPlanLocked, editable, onSave }: { day:AttendanceDay;shiftPlanLocked:boolean;editable:boolean;onSave:(day:AttendanceDay,values:PlanValues,status:string)=>void }) {
  const { t } = useTranslation();
  const language = useCurrentLanguage();
  const dayName = useDateFormatter({ weekday:"long" });
  const fullDate = useDateFormatter({ day:"numeric", month:"long" });
  const shortDate = useDateFormatter({ day:"2-digit", month:"2-digit", year:"numeric" });
  const statusLabels:Record<string,string>={HOLIDAY:t("employee.statuses.HOLIDAY"),OFF:t("employee.statuses.OFF")};
  const[values,setValues]=useState<PlanValues>(()=>({planned_arrival_time:day.planned_arrival_time??"",planned_departure_time:day.planned_departure_time??""}));const[editing,setEditing]=useState<PlanField|null>(null);const[editSession,setEditSession]=useState<EditSession<PlanField>|null>(null);const[statusOpen,setStatusOpen]=useState(false);const[invalid,setInvalid]=useState<PlanField|null>(null);
  useEffect(()=>{setValues({planned_arrival_time:day.planned_arrival_time??"",planned_departure_time:day.planned_departure_time??""});setEditing(null);setEditSession(null);setInvalid(null)},[day]);
  const date=asPragueDate(day.date);const statusValue=day.planned_status??"";const disabled=shiftPlanLocked||!editable||!day.is_within_employment_period||statusValue==="HOLIDAY"||statusValue==="OFF";
  const isDirty=(next:PlanValues,nextStatus=statusValue)=>next.planned_arrival_time!==(day.planned_arrival_time??"")||next.planned_departure_time!==(day.planned_departure_time??"")||nextStatus!==(day.planned_status??"");
  const save=(next:PlanValues,nextStatus=statusValue)=>{if(!isDirty(next,nextStatus)||invalid)return;onSave(day,next,nextStatus)};
  const enterEdit=(field:PlanField)=>{if(disabled)return;setEditing(current=>current??field);setEditSession(current=>current?.field===field?current:{field,originalValue:values[field],revertOnEscape:false});setInvalid(null)};
  const commit=(field:PlanField)=>{const normalized=normalizeTimeInput(values[field]);if(normalized===null){setInvalid(field);return null}const next={...values,[field]:normalized};setValues(next);setInvalid(null);return next};
  const finish=(next:PlanValues)=>{setEditing(null);setEditSession(null);save(next)};
  const blur=(field:PlanField)=>{const next=commit(field);if(next)finish(next)};
  const key=(event:KeyboardEvent<HTMLInputElement>,field:PlanField)=>{
    if(event.key==="Delete"||event.key==="Backspace"){
      if(editing!==field){event.preventDefault();enterEdit(field);return}
      if(values[field]&&editSession?.field===field&&!editSession.revertOnEscape&&values[field]===editSession.originalValue){
        event.preventDefault();
        setValues(current=>({...current,[field]:""}));
        setEditSession(current=>current&&current.field===field?{...current,revertOnEscape:true}:current);
        setInvalid(null);
      }
      return;
    }
    if(event.key==="Escape"){
      event.preventDefault();
      if(editSession?.field===field&&editSession.revertOnEscape){
        setValues(current=>({...current,[field]:editSession.originalValue}));
        setEditing(null);
        setEditSession(null);
        setInvalid(null);
        return;
      }
      const next=commit(field);
      if(next)finish(next);
      return;
    }
    if(event.key!=="Enter")return;
    if(editing!==field){event.preventDefault();enterEdit(field);return}
    event.preventDefault();
    const next=commit(field);
    if(next)finish(next);
  };
  const setPlanStatus=(nextStatus:string)=>{setStatusOpen(false);const next={planned_arrival_time:"",planned_departure_time:""};setValues(next);save(next,nextStatus)};
  const change=(field:PlanField,value:string)=>{setValues(current=>({...current,[field]:value}));setEditSession(current=>current?.field===field&&current.revertOnEscape?{...current,revertOnEscape:false}:current)};
  return <article className={`ledger-day employee-day employee-day--plan employee-day--${statusValue.toLowerCase()||"work"} employee-day--${getCalendarDayTone(date)} ${!day.is_within_employment_period?"ledger-day--outside":""}`}><div className="employee-day__date"><strong>{shortDate.format(date)}</strong><span>{dayName.format(date)}</span><small>{getDayMeta(date, language)}</small></div><TimeCell field="planned_arrival_time" label={t("employee.dayCard.planStart")} planned={null} value={values.planned_arrival_time} editing={editing==="planned_arrival_time"} invalid={invalid==="planned_arrival_time"} disabled={disabled} mobileHidden={false} onEdit={()=>enterEdit("planned_arrival_time")} onChange={value=>change("planned_arrival_time",value)} onBlur={()=>blur("planned_arrival_time")} onKeyDown={event=>key(event,"planned_arrival_time")}/><TimeCell field="planned_departure_time" label={t("employee.dayCard.planEnd")} planned={null} value={values.planned_departure_time} editing={editing==="planned_departure_time"} invalid={invalid==="planned_departure_time"} disabled={disabled} mobileHidden={false} onEdit={()=>enterEdit("planned_departure_time")} onChange={value=>change("planned_departure_time",value)} onBlur={()=>blur("planned_departure_time")} onKeyDown={event=>key(event,"planned_departure_time")}/><div className="employee-day__status"><button type="button" className="icon-button" disabled={shiftPlanLocked||!editable||!day.is_within_employment_period} aria-label={`${fullDate.format(date)} ${t("employee.dayCard.planStatus")}`} title={editable?t("employee.dayCard.planStatus"):t("employee.dayCard.planStatusReadonly")} onClick={()=>setStatusOpen(open=>!open)}><MoreVertical/></button>{statusOpen&&<div className="absence-menu"><button type="button" onClick={()=>setPlanStatus("")}>{t("employee.dayCard.workday")}</button><button type="button" onClick={()=>setPlanStatus("HOLIDAY")}>{t("employee.dayCard.holiday")}</button><button type="button" onClick={()=>setPlanStatus("OFF")}>{t("employee.dayCard.off")}</button></div>}{statusValue&&<small>{statusLabels[statusValue]??statusValue}</small>}</div></article>;
}

function TimeCell({field,label,planned,value,editing,invalid,saved,disabled,mobileHidden,onEdit,onChange,onBlur,onKeyDown}:{field:string;label:string;planned:string|null;value:string;editing:boolean;invalid:boolean;saved?:boolean;disabled:boolean;mobileHidden:boolean;onEdit:()=>void;onChange:(value:string)=>void;onBlur:()=>void;onKeyDown:(event:KeyboardEvent<HTMLInputElement>)=>void}){const { t } = useTranslation();return <label className={`time-cell ${editing?"time-cell--editing":""} ${invalid?"time-cell--invalid":""} ${saved?"time-cell--saved":""} ${mobileHidden?"time-cell--mobile-hidden":""}`}><span>{label}</span><em>{planned?t("employee.dayCard.plannedPrefix",{time:planned}):" "}</em><input name={field} inputMode="numeric" enterKeyHint="done" pattern="[0-9:.,]*" placeholder={t("employee.dayCard.placeholder")} value={value} readOnly={disabled} disabled={disabled} aria-invalid={invalid} onPointerDown={onEdit} onClick={onEdit} onFocus={event=>{const input=event.currentTarget;onEdit();requestAnimationFrame(()=>input.select())}} onChange={event=>onChange(event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown}/></label>}

export function EmployeePage(){
  const { t } = useTranslation();
  const monthName = useDateFormatter({ month:"long", year:"numeric" });
  const[session,setSession]=useState<PortalSession|null>(()=>loadPortalSession());const[month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));const[queueCount,setQueueCount]=useState(0);const[notice,setNotice]=useState("");const[view,setView]=useState<"attendance"|"plan">("attendance");const[savedCell,setSavedCell]=useState<{date:string;field:TimeField;token:number}|null>(null);const[statusConflict,setStatusConflict]=useState<{day:AttendanceDay;status:string}|null>(null);const[inverted,setInverted]=useState(()=>{try{return localStorage.getItem(themeKey)==="light"}catch{return false}});const[isOnline,setIsOnline]=useState(()=>navigator.onLine);const qc=useQueryClient();
  useEffect(() => {
    document.title = `${t("common.appName")} · ${t(session ? "employee.page.title" : "employee.login.title")}`;
  }, [session, t]);
  const employmentId=session?.selected_employment_id??null;
  const query=useQuery({queryKey:["attendance",employmentId,month.getFullYear(),month.getMonth()+1],queryFn:()=>api.attendance(employmentId!,month.getFullYear(),month.getMonth()+1),enabled:!!employmentId,retry:false});
  useEffect(()=>{listOperations().then(items=>setQueueCount(items.length));const allowed=new Set(session?.available_employments.map(item=>item.id)??[]);const online=()=>{setIsOnline(true);flushOperations(allowed).then(async result=>{setQueueCount((await listOperations()).length);if(result.completed)setNotice(t("employee.notices.synced",{count:result.completed}));if(result.blocked)setNotice(t("employee.notices.syncBlocked",{reason:result.blocked.last_error}));qc.invalidateQueries({queryKey:["attendance"]})})};const offline=()=>setIsOnline(false);window.addEventListener("online",online);window.addEventListener("offline",offline);return()=>{window.removeEventListener("online",online);window.removeEventListener("offline",offline)}},[qc,session,t]);
  useEffect(()=>{try{localStorage.setItem(themeKey,inverted?"light":"dark")}catch{/* localStorage is optional */}},[inverted]);
  useEffect(()=>{if(!savedCell)return;const timeout=window.setTimeout(()=>setSavedCell(null),850);return()=>window.clearTimeout(timeout)},[savedCell]);
  const mutation=useMutation({mutationFn:async({day,values}:{day:AttendanceDay;values:TimeValues;field:TimeField})=>{const payload={employment_id:employmentId,date:day.date,arrival_time:values.arrival_time||null,departure_time:values.departure_time||null,arrival_time_2:values.arrival_time_2||null,departure_time_2:values.departure_time_2||null};try{await api.saveAttendance(payload);return{saved:true,queued:false}}catch(error){if(error instanceof ApiError&&error.offline){await queueOperation({kind:"attendance",employment_id:employmentId!,payload});setQueueCount((await listOperations()).length);return{saved:false,queued:true}}throw error}},onSuccess:(result,variables)=>{if(result.queued){setNotice(t("employee.notices.changeQueued"));return}setNotice("");setSavedCell({date:variables.day.date,field:variables.field,token:Date.now()});qc.invalidateQueries({queryKey:["attendance"]})}});
  const planMutation=useMutation({mutationFn:async({day,values,status}:{day:AttendanceDay;values:PlanValues;status:string})=>{const payload={employment_id:employmentId,date:day.date,arrival_time:values.planned_arrival_time||null,departure_time:values.planned_departure_time||null,status:status||null};try{await api.saveShiftPlan(payload);return{saved:true,queued:false}}catch(error){if(error instanceof ApiError&&error.offline){await queueOperation({kind:"shift-plan",employment_id:employmentId!,payload});setQueueCount((await listOperations()).length);return{saved:false,queued:true}}throw error}},onSuccess:result=>{if(result.queued){setNotice(t("employee.notices.shiftPlanQueued"));return}qc.invalidateQueries({queryKey:["attendance"]});setNotice(t("employee.notices.shiftPlanSaved"))}});
  const statusMutation=useMutation({mutationFn:async({day,status,confirmed=false}:{day:AttendanceDay;status:string;confirmed?:boolean})=>{const payload={employment_id:employmentId,date:day.date,status:status||null,confirm_delete_conflicts:confirmed};try{await api.savePortalStatus(payload);return{saved:true,queued:false,conflict:false}}catch(error){if(error instanceof ApiError&&error.offline){await queueOperation({kind:"day-status",employment_id:employmentId!,payload});setQueueCount((await listOperations()).length);return{saved:false,queued:true,conflict:false}}if(error instanceof ApiError&&error.conflict&&!confirmed){setStatusConflict({day,status});return{saved:false,queued:false,conflict:true}}throw error}},onSuccess:result=>{if(result.queued){setNotice(t("employee.notices.statusQueued"));return}if(result.saved){setStatusConflict(null);qc.invalidateQueries({queryKey:["attendance"]});setNotice(t("employee.notices.statusSaved"))}}});
  if(!session)return <EmployeeLogin onLogin={setSession}/>;
  const logout=()=>{clearPortalSession();setSession(null)};
  const actualMinutes=query.data?.days.reduce((total,day)=>total+dayMinutes(day),0)??0;
  const plannedMinutes=query.data?.days.reduce((total,day)=>total+durationMinutes(day.planned_arrival_time,day.planned_departure_time),0)??0;
  const holidayDays=query.data?.days.filter(day=>day.planned_status==="HOLIDAY").length??0;
  const filledDays=query.data?.days.filter(day=>day.arrival_time||day.departure_time||day.arrival_time_2||day.departure_time_2).length??0;
  const attendanceLocked=Boolean(query.data?.attendance_locked);
  const shiftPlanLocked=Boolean(query.data?.shift_plan_locked);
  const lockSummary=attendanceLocked&&shiftPlanLocked?"Docházka i plán uzamčeny":attendanceLocked?"Docházka uzamčena":shiftPlanLocked?"Plán služeb uzamčen":"";
  const showProcessingStatus=Boolean(lockSummary||queueCount||!isOnline);
  const moveMonth=(step:number)=>setMonth(new Date(month.getFullYear(),month.getMonth()+step,1));
  const nowParts=pragueNowParts();
  const today=query.data?.days.find(day=>day.date===nowParts.date);
  const nowField=today?nextEmptyTimeField(today):null;
  const nowDisabled=!today||!nowField||attendanceLocked||!today.is_within_employment_period||today.planned_status==="HOLIDAY"||today.planned_status==="OFF"||mutation.isPending;
  const saveNow=()=>{const current=pragueNowParts();const day=query.data?.days.find(item=>item.date===current.date);if(!day||attendanceLocked||!day.is_within_employment_period||day.planned_status==="HOLIDAY"||day.planned_status==="OFF")return;const field=nextEmptyTimeField(day);if(!field)return;mutation.mutate({day,values:{...dayToValues(day),[field]:current.time},field})};
  return <div className={`employee-app ${inverted?"employee-app--light":""}`}>
    <header className="topbar employee-topbar"><Brand compact/><span>{session.display_name}</span><div className="employee-topbar__actions"><LanguageSwitcher compact /><Button variant="quiet" onClick={()=>setInverted(value=>!value)} aria-label={t("employee.topbar.invertAria")}><Contrast/><span>{t("employee.topbar.invert")}</span></Button><Button variant="quiet" onClick={logout} aria-label={t("employee.topbar.logoutAria")}><LogOut/><span>{t("employee.topbar.logout")}</span></Button></div></header>
    <main id="main-content" className="employee-main"><div className="page employee-page"><h1 className="sr-only">{t("employee.page.title")}</h1>
      <header className="employee-command" aria-label={t("employee.page.summaryLabel")}>
        <div className="employee-command__month-nav"><button className="icon-button" aria-label={t("employee.month.previous")} onClick={()=>moveMonth(-1)} title={t("employee.month.previous")}><ChevronLeft/></button><div className="employee-command__month" title={t("employee.month.visibleMonth",{month:monthName.format(month)})}><CalendarDays/><strong>{monthName.format(month)}</strong></div><button className="icon-button" aria-label={t("employee.month.next")} onClick={()=>moveMonth(1)} title={t("employee.month.next")}><ChevronRight/></button></div>
        <div className="employee-command__metrics"><MetricPill icon={<CalendarClock/>} label={t("employee.metrics.plannedHours")} value={shortHoursLabel(plannedMinutes,t)} title={t("employee.metrics.plannedDetail",{hours:hoursLabel(plannedMinutes,t)})}/><MetricPill icon={<BriefcaseBusiness/>} label={t("employee.metrics.worked")} value={shortHoursLabel(actualMinutes,t)} title={t("employee.metrics.workedDetail",{hours:hoursLabel(actualMinutes,t),days:filledDays})}/><MetricPill icon={<Plane/>} label={t("employee.metrics.holiday")} value={t("employee.units.daysShort",{count:holidayDays})} title={t("employee.metrics.vacationDays",{count:holidayDays})}/>{showProcessingStatus&&<MetricPill className="employee-pill--processing" icon={isOnline?<Wifi/>:<WifiOff/>} label={t("employee.metrics.processing")} value={lockSummary||queueCount?t("employee.metrics.waiting",{count:queueCount}):t("employee.metrics.offline")} title={lockSummary||queueCount?lockSummary||t("employee.metrics.queueWaiting",{count:queueCount}):t("employee.metrics.offlineQueued")}/>}</div>
      </header>
      <div className="employee-mode-switch" role="tablist" aria-label={t("employee.page.switchView")}><button type="button" role="tab" aria-selected={view==="attendance"} className={view==="attendance"?"active":""} onClick={()=>setView("attendance")}><CalendarDays/>{t("employee.page.attendanceTab")}</button><button type="button" role="tab" aria-selected={view==="plan"} className={view==="plan"?"active":""} onClick={()=>setView("plan")}><CalendarRange/>{t("employee.page.planTab")}</button></div><PanelToolbar session={session} onSession={setSession}/>{notice&&<StatusMessage kind={queueCount?"offline":"success"} title={queueCount?t("employee.notices.queuedTitle"):t("employee.notices.doneTitle")}>{notice}</StatusMessage>}{(mutation.error||statusMutation.error||planMutation.error)&&<StatusMessage kind="error" title={t("employee.errors.saveFailed")}>{(mutation.error||statusMutation.error||planMutation.error)?.message}</StatusMessage>}{query.isPending&&<StatusMessage kind="loading" title={t("employee.errors.loading")}/>} {query.error&&<StatusMessage kind="error" title={t("employee.errors.loadFailed")}>{query.error.message}</StatusMessage>}{query.data&&<>{attendanceLocked&&<StatusMessage kind="offline" title="Docházka je uzamčena">Zápisy docházky jsou pro tento úvazek a měsíc pouze pro čtení.</StatusMessage>}{shiftPlanLocked&&<StatusMessage kind="offline" title="Plán služeb je uzamčen">Zápisy plánu služeb jsou pro tento úvazek a měsíc pouze pro čtení.</StatusMessage>}{view==="plan"&&!(query.data.shift_plan_editable ?? false)&&!shiftPlanLocked&&<StatusMessage kind="offline" title={t("employee.errors.planReadonlyTitle")}>{t("employee.errors.planReadonlyBody")}</StatusMessage>}<section className="ledger employee-ledger" aria-label={view==="attendance"?t("employee.page.attendanceDays"):t("employee.page.shiftPlanDays")}>{query.data.days.map(day=>view==="attendance"?<DayCard key={day.date} day={day} attendanceLocked={attendanceLocked} savedField={savedCell?.date===day.date?savedCell.field:null} onSave={(d,values,field)=>mutation.mutate({day:d,values,field})} onStatus={(d,status,confirmed)=>statusMutation.mutate({day:d,status,confirmed})}/>:<PlanDayCard key={day.date} day={day} shiftPlanLocked={shiftPlanLocked} editable={query.data.shift_plan_editable ?? false} onSave={(d,values,status)=>planMutation.mutate({day:d,values,status})}/>)}</section></>}{statusConflict&&<Modal title={t("employee.errors.conflictTitle")} description={t("employee.errors.conflictBody",{date:statusConflict.day.date})} confirmLabel={t("employee.errors.conflictConfirm")} danger onClose={()=>setStatusConflict(null)} onConfirm={()=>statusMutation.mutate({...statusConflict,confirmed:true})}/>}</div></main>{view==="attendance"&&<footer className="employee-nowbar" aria-label={t("employee.quickNow.label")}><button type="button" disabled={nowDisabled} onClick={saveNow}><TimerReset/><span>{t("employee.quickNow.button")}</span></button></footer>}
  </div>;
}

function MetricPill({icon,label,value,title,className=""}:{icon:ReactNode;label:string;value:string;title:string;className?:string}){return <span className={`employee-pill ${className}`} title={title} aria-label={title}>{icon}<span>{label}</span><strong>{value}</strong></span>}

function PanelToolbar({session,onSession}:{session:PortalSession;onSession:(s:PortalSession)=>void}){const { t } = useTranslation();return <div className="panel toolbar employee-employment"><Field label={t("employee.page.activeEmployment")}><select value={session.selected_employment_id??""} onChange={e=>onSession(selectEmployment(session,Number(e.target.value)))}>{session.available_employments.map(e=><option key={e.id} value={e.id}>{e.label??`${e.title} · ${e.employment_type}`}</option>)}</select></Field><span className="badge badge--good"><CalendarDays/>{t("employee.page.pragueTime")}</span></div>}
