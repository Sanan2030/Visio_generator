export const HISTORY_LIMIT = 30;
export const HISTORY_MERGE_WINDOW = 600;

export interface HistoryGroup {
  key: string;
  changedAt: number;
}

/** Only consecutive text edits in the same field share an undo snapshot. */
export function recordHistory<T>(
  snapshots: readonly T[],
  previous: T,
  group: HistoryGroup | null,
  key: string | undefined,
  changedAt: number,
): { snapshots: T[]; group: HistoryGroup | null } {
  const elapsed = group ? changedAt - group.changedAt : Infinity;
  const merge = !!key && key === group?.key && elapsed >= 0 && elapsed < HISTORY_MERGE_WINDOW;
  return {
    snapshots: merge ? [...snapshots] : [...snapshots.slice(-(HISTORY_LIMIT - 1)), previous],
    group: key ? { key, changedAt } : null,
  };
}
