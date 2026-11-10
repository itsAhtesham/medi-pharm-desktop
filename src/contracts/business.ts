import { z } from 'zod';
import { businessDate, quantityMilli } from '../domain/values';
export const textKey = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const name = z.string().trim().min(1).max(120);
const notes = z.string().trim().max(2000);
export const dateSchema = z.string().refine((s) => {
  try {
    businessDate(s);
    return true;
  } catch {
    return false;
  }
}, 'Enter a real calendar date.');
const quantity = z
  .string()
  .trim()
  .refine((s) => {
    try {
      quantityMilli(s);
      return true;
    } catch {
      return false;
    }
  }, 'Use a positive quantity up to 999999 with at most three decimal places.');
export const units = [
  'tablets',
  'strips',
  'capsules',
  'bottles',
  'packs',
  'tubes',
  'sachets',
  'other',
] as const;
const version = z.number().int().positive();
const base = { requestId: z.uuid(), id: z.uuid().nullable(), expectedVersion: version.nullable() };
export const customerInputSchema = z
  .object({
    ...base,
    kind: z.literal('customer'),
    name,
    phone: z
      .string()
      .trim()
      .max(40)
      .regex(/^\+?[\d ()-]+$/)
      .refine((s) => {
        const n = s.replace(/\D/g, '');
        return n.length >= 7 && n.length <= 15;
      }, 'Enter 7–15 phone digits.'),
    age: z.number().int().min(0).max(130).nullable(),
    notes,
    archived: z.boolean(),
  })
  .strict();
export const medicineInputSchema = z
  .object({
    ...base,
    kind: z.literal('medicine'),
    name,
    strength: z.string().trim().max(80),
    form: z.string().trim().min(1).max(80),
    archived: z.boolean(),
  })
  .strict();
export const itemInputSchema = z
  .object({ medicineId: z.uuid(), quantity, unit: z.enum(units) })
  .strict();
export const supplyInputSchema = z
  .object({
    medicineId: z.uuid(),
    start: dateSchema,
    days: z.number().int().min(1).max(365),
    mode: z.enum(['extend', 'replace']).nullable(),
    remaining: z.number().int().min(0).max(365).nullable(),
    reminder: z.boolean(),
    manualDate: dateSchema.nullable(),
    confirmLate: z.boolean(),
  })
  .strict();
export const purchaseDraftSchema = z
  .object({
    id: z.uuid().nullable(),
    expectedVersion: version.nullable(),
    customerId: z.uuid(),
    date: dateSchema,
    notes,
    reason: notes,
    items: z.array(itemInputSchema).min(1).max(50),
    supplies: z.array(supplyInputSchema).min(1).max(50),
  })
  .strict();
export const purchaseInputSchema = purchaseDraftSchema.extend({
  kind: z.literal('purchase'),
  requestId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
});
export const cancelInputSchema = z
  .object({
    kind: z.literal('cancel'),
    requestId: z.uuid(),
    id: z.uuid(),
    expectedVersion: version,
    expectedRevision: z.number().int().nonnegative(),
    reason: notes.min(1),
  })
  .strict();
export const followInputSchema = z
  .object({
    kind: z.literal('followup'),
    requestId: z.uuid(),
    id: z.uuid(),
    expectedVersion: version,
    action: z.enum(['contact', 'snooze', 'close', 'reopen']),
    note: notes,
    date: dateSchema.nullable(),
  })
  .strict();
export const businessMutationSchema = z.discriminatedUnion('kind', [
  customerInputSchema,
  medicineInputSchema,
  purchaseInputSchema,
  cancelInputSchema,
  followInputSchema,
]);
export type BusinessMutation = z.infer<typeof businessMutationSchema>;
export type PurchaseDraft = z.infer<typeof purchaseDraftSchema>;
export const mutationResultSchema = z
  .object({ id: z.uuid(), version, revision: z.number().int().nonnegative() })
  .strict();
export const querySchema = z
  .object({
    kind: z.enum(['customers', 'medicines', 'purchases', 'followups', 'history']),
    search: z.string().trim().max(120).default(''),
    page: z.number().int().min(0).max(100000).default(0),
    archived: z.boolean().default(false),
    id: z.uuid().optional(),
    customerId: z.uuid().optional(),
    medicineId: z.uuid().optional(),
    tab: z.enum(['due', 'scheduled', 'closed', 'all']).default('due'),
  })
  .strict();
const common = { id: z.uuid(), name: z.string(), version, archived_at: z.number().nullable() };
export const customerSchema = z.object({
  ...common,
  phone: z.string(),
  age: z.number().nullable(),
  notes: z.string(),
});
export const medicineSchema = z.object({ ...common, strength: z.string(), form: z.string() });
export const itemSchema = z.object({
  medicine_id: z.uuid(),
  name_snapshot: z.string(),
  strength_snapshot: z.string(),
  form_snapshot: z.string(),
  quantity_milli: z.number().int(),
  unit: z.enum(units),
});
export const supplySchema = z.object({
  id: z.uuid(),
  medicine_id: z.uuid(),
  start_date: dateSchema,
  new_days: z.number().int(),
  mode: z.enum(['extend', 'replace']),
  remaining_override: z.number().nullable(),
  remaining_used: z.number(),
  run_out_date: dateSchema,
  reminder_enabled: z.number(),
  manual_reminder_date: dateSchema.nullable(),
});
export const purchaseSchema = z.object({
  id: z.uuid(),
  customer_id: z.uuid(),
  customer_name: z.string(),
  sequence: z.number(),
  purchase_date: dateSchema,
  notes: z.string(),
  status: z.enum(['active', 'cancelled']),
  version,
  items: z.array(itemSchema),
  supplies: z.array(supplySchema),
});
export const followSchema = z.object({
  id: z.uuid(),
  customer_id: z.uuid(),
  customer_name: z.string(),
  phone: z.string(),
  medicine_id: z.uuid(),
  medicine_name: z.string(),
  purchase_id: z.uuid(),
  sequence: z.number(),
  status: z.enum(['open', 'closed', 'superseded']),
  next_date: dateSchema,
  run_out_date: dateSchema,
  last_contact_at: z.number().nullable(),
  closure_reason: z.string().nullable(),
  version,
});
export const historySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  note: z.string(),
  created_at: z.number(),
  before_json: z.string(),
  after_json: z.string(),
});
export const queryResultSchema = z
  .object({
    revision: z.number().int(),
    today: dateSchema,
    total: z.number().int(),
    customers: z.array(customerSchema),
    medicines: z.array(medicineSchema),
    purchases: z.array(purchaseSchema),
    followups: z.array(followSchema),
    history: z.array(historySchema),
  })
  .strict();
export const previewSchema = z
  .object({
    revision: z.number().int(),
    supplies: z.array(
      z.object({
        medicineId: z.uuid(),
        remaining: z.number().int(),
        runOut: dateSchema,
        reminder: dateSchema,
        hasPrevious: z.boolean(),
      }),
    ),
  })
  .strict();
export type BusinessQuery = z.input<typeof querySchema>;
export type BusinessData = z.infer<typeof queryResultSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type Medicine = z.infer<typeof medicineSchema>;
export type Purchase = z.infer<typeof purchaseSchema>;
export type FollowUp = z.infer<typeof followSchema>;
export type Preview = z.infer<typeof previewSchema>;
