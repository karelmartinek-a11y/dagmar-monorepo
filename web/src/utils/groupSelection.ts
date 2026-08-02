export function reconcileSelectedGroup(
  selectedGroup: number | null,
  groups: Array<{ id: number }>,
): number | null {
  if (selectedGroup !== null && groups.some((group) => group.id === selectedGroup))
    return selectedGroup;
  return groups.length === 1 ? groups[0].id : null;
}
