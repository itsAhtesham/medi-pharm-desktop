import { z } from 'zod';
import { dateSchema, followSchema } from './business';
const count = z.number().int().nonnegative();
export const dashboardSchema = z
  .object({
    today: dateSchema,
    revision: count,
    activeCustomers: count,
    activeMedicines: count,
    purchasesToday: count,
    dueCycles: count,
    dueCustomers: count,
    overdueCycles: count,
    overdueCustomers: count,
    scheduledCycles: count,
    endingSupplies: count,
    endingCustomers: count,
    purchasesByDay: z.array(z.object({ day: dateSchema, count })).length(7),
    due: z.array(followSchema).max(6),
    upcoming: z.array(followSchema).max(6),
    ending: z
      .array(
        z.object({
          customerId: z.uuid(),
          customer: z.string(),
          medicine: z.string(),
          runOut: dateSchema,
          daysLeft: count,
        }),
      )
      .max(6),
    recent: z
      .array(
        z.object({
          id: z.uuid(),
          action: z.enum([
            'business.customer',
            'business.medicine',
            'business.purchase',
            'business.cancel',
            'business.followup',
          ]),
          label: z.string(),
          at: z.number(),
        }),
      )
      .max(5),
  })
  .strict();
export type DashboardData = z.infer<typeof dashboardSchema>;
