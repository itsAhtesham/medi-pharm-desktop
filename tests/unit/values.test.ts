import { describe, expect, it } from 'vitest';
import { addDays, businessDate, pharmacyDay, quantityMilli } from '../../src/domain/values';
describe('exact pharmacy values', () => {
  it('parses bounded quantities without rounding', () => {
    expect(quantityMilli('1.250')).toBe(1250);
    expect(quantityMilli('0.001')).toBe(1);
    expect(quantityMilli('999999')).toBe(999999000);
    for (const value of ['0', '-1', '1.0001', '1e2', '999999.001', 'NaN', '1,2', '01'])
      expect(() => quantityMilli(value)).toThrow();
  });
  it('uses real date-only calendar arithmetic and the pharmacy timezone', () => {
    expect(businessDate('2024-02-29')).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-11-01', 7)).toBe('2026-11-08');
    expect(pharmacyDay(Date.parse('2026-11-01T20:00:00Z'))).toBe('2026-11-02');
    for (const value of ['2025-02-29', '2026-04-31', '2026-1-1', '0000-01-01'])
      expect(() => businessDate(value)).toThrow();
    expect(() => addDays('9999-12-31', 1)).toThrow();
  });
});
