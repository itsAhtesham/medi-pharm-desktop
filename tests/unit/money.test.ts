import { expect, it } from 'vitest';
import {
  calculatePurchaseMoney,
  formatDecimalMinor,
  formatMoneyMinor,
  MAX_MONEY_MINOR,
  parseMoneyMinor,
  parsePercentBps,
} from '../../src/domain/money';

it('round trips exact paise including zero and the maximum and formats large aggregates', () => {
  for (const n of [0, 1, 30, 12550, MAX_MONEY_MINOR])
    expect(parseMoneyMinor(formatDecimalMinor(n))).toBe(n);
  expect(formatMoneyMinor('9007199254740993')).toBe('₹9,00,71,99,25,47,409.93');
  expect(parseMoneyMinor(' 125.5 ')).toBe(12550);
  for (const input of ['', '1e3', '-1', '1.005', '.1', '1.', '₹2', '1,250', '100000000', 'NaN'])
    expect(() => parseMoneyMinor(input)).toThrow();
  expect(() => parsePercentBps('100.01')).toThrow();
});
it('applies one purchase discount to entered line totals and rounds half a paise up', () => {
  const calculate = (amount: string, percent: string) =>
    calculatePurchaseMoney([{ amount }], { type: 'percentage', percent });
  expect(calculate('0.01', '50').discount_amount_minor).toBe(1);
  expect(calculate('0.03', '50').total_amount_minor).toBe(1);
  expect(calculate('0.01', '0.01')).toMatchObject({
    discount_type: 'percentage',
    discount_amount_minor: 0,
    discount_percent_bps: 1,
  });
  expect(calculate('0', '0')).toMatchObject({ discount_type: 'none', total_amount_minor: 0 });
  expect(calculate('12.50', '100').total_amount_minor).toBe(0);
  expect(
    calculatePurchaseMoney([{ amount: '0.10' }, { amount: '0.20' }], { type: 'fixed', amount: '' }),
  ).toMatchObject({ subtotal_minor: 30, total_amount_minor: 30, discount_type: 'none' });
  expect(
    calculatePurchaseMoney([{ amount: '1000' }], { type: 'fixed', amount: '125.50' })
      .total_amount_minor,
  ).toBe(87450);
  expect(() =>
    calculatePurchaseMoney([{ amount: '0.01' }], { type: 'fixed', amount: '0.02' }),
  ).toThrow('exceeds');
  expect(() =>
    calculatePurchaseMoney([{ amount: '99999999.99' }, { amount: '0.01' }], { type: 'none' }),
  ).toThrow('subtotal');
  expect(() => calculatePurchaseMoney([{ amount: '' }], { type: 'none' })).toThrow('Row 1');
});
