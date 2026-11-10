/** Quantities never pass through floating-point multiplication. */
export function quantityMilli(input: string): number {
  const match = /^(0|[1-9]\d{0,5})(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!match) throw new Error('Enter a quantity with at most three decimal places.');
  const value = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  if (value < 1 || value > 999999000) throw new Error('Quantity is outside the allowed range.');
  return value;
}
export function businessDate(input: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || input < '0001-01-01' || input > '9999-12-31')
    throw new Error('Invalid business date.');
  const date = new Date(`${input}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== input)
    throw new Error('Invalid calendar date.');
  return input;
}
export function addDays(input: string, days: number): string {
  businessDate(input);
  if (!Number.isSafeInteger(days)) throw new Error('Invalid day count.');
  const date = new Date(`${input}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.valueOf())) throw new Error('Date is out of range.');
  return businessDate(date.toISOString().slice(0, 10));
}
export function pharmacyDay(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
