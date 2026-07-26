import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { EmploymentGroup } from "../api/types";
import { Button, Field, Modal, Panel, StatusMessage } from "../components/Primitives";

type EmploymentOption = { id: number; display_label: string };

export function AdminEmploymentGroupsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [deleting, setDeleting] = useState<EmploymentGroup | null>(null);
  const groups = useQuery({ queryKey: ["employment-groups"], queryFn: () => api.admin<{ groups: EmploymentGroup[] }>("/api/v1/admin/employment-groups") });
  const employments = useQuery({
    queryKey: ["employment-groups-options"],
    queryFn: () => api.admin<{ available_employments: EmploymentOption[] }>(`/api/v1/admin/shift-plan?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["employment-groups"] });
  const create = useMutation({
    mutationFn: () => api.admin<EmploymentGroup>("/api/v1/admin/employment-groups", { method: "POST", body: JSON.stringify({ name, employment_ids: memberIds }) }),
    onSuccess: () => { setName(""); setMemberIds([]); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: (group: EmploymentGroup) => api.admin(`/api/v1/admin/employment-groups/${group.id}`, { method: "DELETE" }),
    onSuccess: () => { setDeleting(null); invalidate(); },
  });
  const toggle = (id: number, checked: boolean) => setMemberIds((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  return <div className="page">
    <header className="page-heading"><div><p>Plán služeb</p><h1>Skupiny úvazků</h1></div></header>
    <div className="split"><Panel title="Nová skupina"><div className="panel-body form-grid">
      <Field label="Název skupiny"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <div className="full"><p>Vyberte nejméně dva úvazky ({memberIds.length} vybráno).</p><div className="admin-chip-grid">{(employments.data?.available_employments ?? []).map((employment) => <label key={employment.id} className={`admin-chip admin-chip--checkbox ${memberIds.includes(employment.id) ? "admin-chip--active" : ""}`}><input type="checkbox" checked={memberIds.includes(employment.id)} onChange={(event) => toggle(employment.id, event.target.checked)} />{employment.display_label}</label>)}</div></div>
      {create.error && <StatusMessage kind="error" title="Skupinu nelze uložit">{create.error.message}</StatusMessage>}
      <div className="full"><Button disabled={!name.trim() || memberIds.length < 2 || create.isPending} onClick={() => create.mutate()}>Vytvořit skupinu</Button></div>
    </div></Panel><Panel title="Existující skupiny"><div className="panel-body stack">
      {groups.isPending && <StatusMessage kind="loading" title="Načítám skupiny" />}
      {groups.error && <StatusMessage kind="error" title="Skupiny nelze načíst">{groups.error.message}</StatusMessage>}
      {groups.data?.groups.length === 0 && <StatusMessage kind="empty" title="Zatím nejsou vytvořené žádné skupiny." />}
      {groups.data?.groups.map((group) => <article key={group.id} className="panel"><div className="panel-body"><div className="page-actions"><div><strong>{group.name}</strong><p>{group.members.length} členů</p></div><Button variant="danger" onClick={() => setDeleting(group)}>Odstranit</Button></div><ul>{group.members.map((member) => <li key={member.employment_id}>{member.display_label}</li>)}</ul></div></article>)}
    </div></Panel></div>
    {deleting && <Modal title="Odstranit skupinu?" description={`Skupina „${deleting.name}“ bude odstraněna. Plány směn zůstanou beze změny.`} confirmLabel="Odstranit" danger onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} />}
  </div>;
}
