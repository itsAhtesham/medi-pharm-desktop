import { z } from 'zod';
import { customerSchema, dateSchema } from './business';
const search = z.string().trim().max(120).default('');
const catalogue = { search, status: z.enum(['active', 'archived', 'all']).default('all') };
const follow = {
  search,
  tab: z.enum(['due', 'scheduled', 'closed', 'all']).default('all'),
  customerId: z.uuid().optional(),
};
const purchases = { search, customerId: z.uuid().optional(), medicineId: z.uuid().optional() };
export const csvInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('customers'), ...catalogue }).strict(),
  z.object({ kind: z.literal('medicines'), ...catalogue }).strict(),
  z.object({ kind: z.literal('purchases'), ...purchases }).strict(),
  z.object({ kind: z.literal('purchaseTotals'), ...purchases }).strict(),
  z.object({ kind: z.literal('followups'), ...follow }).strict(),
  z.object({ kind: z.literal('followupHistory'), ...follow }).strict(),
]);
export type CsvInput = z.input<typeof csvInputSchema>;
export const csvServiceInputSchema = z
  .object({ selection: csvInputSchema, filename: z.string().min(1).max(4096) })
  .strict();
export const csvResultSchema = z
  .object({
    saved: z.boolean(),
    rows: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  })
  .strict();
export type CsvResult = z.infer<typeof csvResultSchema>;
export const supplyQuerySchema = z
  .object({ customerId: z.uuid(), search, page: z.number().int().min(0).max(100000).default(0) })
  .strict();
export type SupplyQuery = z.input<typeof supplyQuerySchema>;
export const currentSupplySchema = z.object({
  medicineId: z.uuid(),
  name: z.string(),
  strength: z.string(),
  form: z.string(),
  archived: z.boolean(),
  purchaseId: z.uuid(),
  sequence: z.number().int(),
  purchaseDate: dateSchema,
  start: dateSchema,
  newDays: z.number().int(),
  carriedDays: z.number().int(),
  runOut: dateSchema,
  coverageRunOut: dateSchema.nullable(),
  remainingDays: z.number().int().nonnegative(),
  nextStart: dateSchema.nullable(),
  coverage: z.enum(['notStarted', 'available', 'runsOutToday', 'ranOut']),
  reminder: z.enum(['disabled', 'due', 'overdue', 'scheduled', 'closed']),
  nextContact: dateSchema.nullable(),
  lastContact: z.number().nullable(),
  closureReason: z.string().nullable(),
});
export const supplyResultSchema = z
  .object({
    customer: customerSchema,
    today: dateSchema,
    revision: z.number().int(),
    total: z.number().int().nonnegative(),
    supplies: z.array(currentSupplySchema),
  })
  .strict();
export type SupplyResult = z.infer<typeof supplyResultSchema>;
