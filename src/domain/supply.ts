import { addDays, businessDate } from './values';
export function daysBetween(start: string, end: string): number {
  return (
    (Date.parse(`${businessDate(end)}T00:00:00Z`) -
      Date.parse(`${businessDate(start)}T00:00:00Z`)) /
    86400000
  );
}
export function calculateSupply(
  start: string,
  days: number,
  mode: 'extend' | 'replace',
  override: number | null,
  previous: string | null,
) {
  const remaining =
    mode === 'replace'
      ? 0
      : (override ?? (previous ? Math.max(0, daysBetween(start, previous)) : 0));
  const runOut = addDays(start, remaining + days);
  const reminder = addDays(runOut, -Math.min(7, Math.max(1, Math.floor(days * 0.25 + 0.5))));
  return { remaining, runOut, reminder };
}
