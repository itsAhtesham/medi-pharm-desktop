export const MAX_MONEY_MINOR = 9_999_999_999;
export type Discount =
  { type: 'none' } | { type: 'fixed'; amount: string } | { type: 'percentage'; percent: string };

function parseDecimal(text: string, maximum: number, message: string): number {
  const parts = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!parts) throw new Error(message);
  const whole = parts[1].replace(/^0+/, '');
  if (whole.length > String(maximum).length) throw new Error(message);
  const minor = BigInt(whole || '0') * 100n + BigInt((parts[2] ?? '').padEnd(2, '0'));
  if (minor > maximum) throw new Error(message);
  return Number(minor);
}
export function parseMoneyMinor(text: string) {
  return parseDecimal(
    text,
    MAX_MONEY_MINOR,
    'Enter a rupee amount from 0 to 99999999.99 with at most two decimal places.',
  );
}
export function parsePercentBps(text: string) {
  return parseDecimal(
    text,
    10000,
    'Enter a percentage from 0 to 100 with at most two decimal places.',
  );
}
export function calculatePurchaseMoney(rows: readonly { amount: string }[], discount: Discount) {
  if (!rows.length) throw new Error('Add a medicine row to calculate the total.');
  let subtotal = 0n;
  for (const [i, row] of rows.entries()) {
    try {
      subtotal += BigInt(parseMoneyMinor(row.amount));
    } catch (error) {
      throw new Error(`Row ${i + 1}: ${(error as Error).message}`, { cause: error });
    }
  }
  if (subtotal > MAX_MONEY_MINOR) throw new Error('The subtotal exceeds ₹9,99,99,999.99.');
  let deduction = 0n;
  let bps = 0;
  if (discount.type === 'fixed' && discount.amount.trim())
    deduction = BigInt(parseMoneyMinor(discount.amount));
  if (discount.type === 'percentage' && discount.percent.trim()) {
    bps = parsePercentBps(discount.percent);
    deduction = (subtotal * BigInt(bps) + 5000n) / 10000n;
  }
  if (deduction > subtotal) throw new Error('The discount exceeds the subtotal.');
  return {
    currency_code: 'INR' as const,
    subtotal_minor: Number(subtotal),
    discount_type: bps > 0 || deduction > 0n ? discount.type : ('none' as const),
    discount_percent_bps: bps || null,
    discount_amount_minor: Number(deduction),
    total_amount_minor: Number(subtotal - deduction),
  };
}
export function formatDecimalMinor(value: number | bigint | string) {
  const n = BigInt(value);
  return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}
const inr = new Intl.NumberFormat('en-IN');
export function formatMoneyMinor(value: number | bigint | string) {
  const [whole, fraction] = formatDecimalMinor(value).split('.');
  return `₹${inr.format(BigInt(whole))}.${fraction}`;
}
