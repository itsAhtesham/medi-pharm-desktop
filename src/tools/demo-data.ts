import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { OwnerService } from '../application/owner-service';
import { BusinessService } from '../application/business-service';
import { DashboardService } from '../application/dashboard-service';
import { PharmacyDatabase } from '../db/pharmacy-database';
import { inspectDatabase } from '../db/health';
import type { PurchaseDraft, BusinessMutation } from '../contracts/business';
import { addDays, pharmacyDay } from '../domain/values';
import { formatDecimalMinor, parseMoneyMinor } from '../domain/money';
import { atomicJson } from '../platform/durable-files';

export const demoAccess = { identifier: 'demo-owner', password: 'Demo pharmacy 123!' };
export const demoCounts = { customers: 50, medicines: 60, purchases: 180 };
export const demoMarker = 'demo-profile.json';
const firstNames = [
  'Aarav',
  'Asha',
  'Kabir',
  'Meera',
  'Ishaan',
  'Sana',
  'Vihaan',
  'Diya',
  'Arjun',
  'Zoya',
];
const surnames = ['Sharma', 'Rao', 'Patel', 'Khan', 'Das'];
const products = [
  'Aster',
  'Birch',
  'Cedar',
  'Dahlia',
  'Elm',
  'Fern',
  'Grove',
  'Hazel',
  'Iris',
  'Juniper',
];
const forms = ['tablet', 'capsule', 'syrup', 'cream', 'powder', 'drops'];
const defaultUnits = ['tablets', 'capsules', 'bottles', 'tubes', 'sachets', 'bottles'] as const;

/** Own a brand-new directory and seed through the real validation/mutation path. */
export async function createDemoProfile(root: string, timestamp = Date.now()) {
  if (!path.isAbsolute(root)) throw new Error('The demo profile path must be absolute.');
  mkdirSync(path.dirname(root), { recursive: true });
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        `Profile already exists: ${root}. Use --profile with a new folder; existing data is never replaced.`,
        { cause: error },
      );
    throw error;
  }
  const today = pharmacyDay(timestamp);
  const access = { ...demoAccess, recoveryCode: randomBytes(32).toString('hex') };
  const marker = {
    format: 1,
    kind: 'medipharm-demo',
    status: 'building',
    seededAt: new Date(timestamp).toISOString(),
    today,
    access,
  };
  atomicJson(path.join(root, demoMarker), marker);
  let owner: OwnerService | undefined;
  try {
    owner = new OwnerService(new PharmacyDatabase(root), () => timestamp);
    await owner.setup({ ...access, pharmacyName: 'MediPharm Demo — Synthetic Data' });
    await owner.login(demoAccess);
    const service = new BusinessService(owner, () => timestamp);
    const customers: Extract<BusinessMutation, { kind: 'customer' }>[] = [];
    const medicines: Extract<BusinessMutation, { kind: 'medicine' }>[] = [];
    for (let i = 0; i < demoCounts.customers; i++) {
      const input: (typeof customers)[number] = {
        kind: 'customer',
        requestId: randomUUID(),
        id: null,
        expectedVersion: null,
        name: `Demo ${String(i + 1).padStart(2, '0')} · ${firstNames[i % firstNames.length]} ${surnames[Math.floor(i / firstNames.length)]}`,
        // Deliberately synthetic; pairs exercise shared family phone search.
        phone: `00000${String(Math.floor(i / 2) + 1).padStart(5, '0')}`,
        age: i % 8 === 0 ? null : 18 + ((i * 7) % 70),
        notes: 'Synthetic test customer. Not a real person or contact number.',
        archived: false,
      };
      const saved = service.save(input);
      customers.push({ ...input, id: saved.id, expectedVersion: saved.version });
    }
    for (let i = 0; i < demoCounts.medicines; i++) {
      const form = i % forms.length;
      const input: (typeof medicines)[number] = {
        kind: 'medicine',
        requestId: randomUUID(),
        id: null,
        expectedVersion: null,
        name: `Demo ${products[i % products.length]} ${String(i + 1).padStart(2, '0')}`,
        strength: form === 2 || form === 5 ? `${25 + i * 5} ml` : `${5 + i * 5} mg`,
        form: forms[form],
        archived: false,
      };
      const saved = service.save(input);
      medicines.push({ ...input, id: saved.id, expectedVersion: saved.version });
    }
    const purchases: { id: string; draft: PurchaseDraft }[] = [];
    function savePurchase(draft: PurchaseDraft) {
      const preview = service.preview(draft);
      return service.save({
        ...draft,
        kind: 'purchase',
        requestId: randomUUID(),
        previewFingerprint: preview.fingerprint,
        expectedRevision: preview.revision,
      });
    }
    for (let i = 0; i < demoCounts.purchases; i++) {
      // Historical months plus a dense fortnight for both Overview graphs.
      const offset =
        i < 120 ? -330 + Math.floor((i * 300) / 119) : -13 + Math.floor(((i - 120) * 13) / 59);
      const date = addDays(today, offset);
      // One busy customer has >20 purchases to exercise history pagination.
      const customerIndex = i % 6 === 0 ? 0 : 1 + (i % 49);
      const indexes = [
        ...new Set([
          customerIndex,
          ...Array.from({ length: i % 3 }, (_, n) => (i * 7 + n * 13) % medicines.length),
        ]),
      ];
      const items: PurchaseDraft['items'] = indexes.map((index, n) => ({
        medicineId: medicines[index].id!,
        quantity: i % 11 === 0 && n === 0 ? '1.250' : String(1 + ((i + n) % 6)),
        unit: defaultUnits[index % forms.length],
        amount:
          i % 29 === 0 && n === 0
            ? '0.00'
            : formatDecimalMinor(2500 + ((i * 137 + n * 271) % 250000)),
      }));
      if (i % 10 === 0)
        items.push({
          medicineId: items[0].medicineId,
          quantity: '2',
          unit: 'packs',
          amount: '35.75',
        });
      const subtotal = items.reduce((total, item) => total + parseMoneyMinor(item.amount), 0);
      const discount: PurchaseDraft['pricing']['discount'] =
        i % 31 === 0
          ? { type: 'percentage', percent: '100' }
          : i % 4 === 1
            ? { type: 'fixed', amount: formatDecimalMinor(Math.min(500, subtotal)) }
            : i % 4 === 2
              ? { type: 'percentage', percent: '10' }
              : i % 4 === 3
                ? { type: 'percentage', percent: '12.50' }
                : { type: 'none' };
      const draft: PurchaseDraft = {
        id: null,
        expectedVersion: null,
        customerId: customers[customerIndex].id!,
        date,
        notes: `Synthetic purchase ${String(i + 1).padStart(3, '0')}. Amounts and supply durations are test values.`,
        reason: '',
        pricing: { currencyCode: 'INR', discount },
        items,
        supplies: indexes.map((index, n) => {
          const start = i === demoCounts.purchases - 1 ? addDays(today, 3) : date;
          const reminder = (i + n) % 5 !== 0;
          return {
            medicineId: medicines[index].id!,
            start,
            days: 1 + ((i + n) % 4) * 7,
            mode: i % 4 === 0 ? 'extend' : 'replace',
            remaining: null,
            reminder,
            manualDate: reminder && i % 17 === 0 ? start : null,
            confirmLate: false,
          };
        }),
      };
      purchases.push({ id: savePurchase(draft).id, draft });
    }
    for (let i = 0; i < purchases.length; i += 18) {
      const current = service.query({ kind: 'purchases', id: purchases[i].id });
      service.save({
        kind: 'cancel',
        requestId: randomUUID(),
        id: purchases[i].id,
        expectedVersion: current.purchases[0].version,
        expectedRevision: current.revision,
        reason: 'Synthetic cancellation for history and total testing.',
      });
    }
    const last = purchases[purchases.length - 1];
    const record = service.query({ kind: 'purchases', id: last.id }).purchases[0];
    savePurchase({
      ...last.draft,
      id: last.id,
      expectedVersion: record.version,
      reason: 'Synthetic amount correction for audit testing.',
      items: last.draft.items.map((item, i) =>
        i === 0
          ? { ...item, amount: formatDecimalMinor(parseMoneyMinor(item.amount) + 250) }
          : item,
      ),
    });

    const cycles = [];
    for (let page = 0; ; page++) {
      const result = service.query({ kind: 'followups', tab: 'all', page });
      cycles.push(...result.followups.filter((f) => f.status === 'open'));
      if ((page + 1) * 20 >= result.total) break;
    }
    for (const [i, f] of cycles.slice(0, 15).entries()) {
      const action = i % 3 === 0 ? 'contact' : i % 3 === 1 ? 'snooze' : 'close';
      service.save({
        kind: 'followup',
        requestId: randomUUID(),
        id: f.id,
        expectedVersion: f.version,
        action,
        note: `Synthetic ${action} for demo follow-up history.`,
        date: action === 'snooze' ? addDays(today, 5) : null,
      });
    }
    // Archive after purchase creation so historical links remain realistic.
    for (const customer of customers.slice(-3))
      service.save({ ...customer, requestId: randomUUID(), archived: true });
    for (const medicine of medicines.slice(-5))
      service.save({ ...medicine, requestId: randomUUID(), archived: true });
    const dashboard = new DashboardService(owner, () => timestamp);
    const daily = dashboard.read('daily');
    const monthly = dashboard.read('monthly');
    const summary = {
      ...demoCounts,
      activeCustomers: daily.activeCustomers,
      activeMedicines: daily.activeMedicines,
      activePurchases: demoCounts.purchases - 10,
      cancelledPurchases: 10,
      purchasesToday: daily.purchasesToday,
      dueCycles: daily.dueCycles,
      scheduledCycles: daily.scheduledCycles,
      dailyValueMinor: daily.purchaseValue.totalMinor,
      monthlyValueMinor: monthly.purchaseValue.totalMinor,
    };
    owner.close();
    owner = undefined;
    const info = inspectDatabase(path.join(root, 'data', 'live', 'medipharm.sqlite'));
    for (const kind of ['customers', 'medicines', 'purchases'] as const)
      if (info[kind] !== demoCounts[kind]) throw new Error(`Unexpected seeded ${kind} count.`);
    const result = { ...marker, status: 'ready', summary };
    atomicJson(path.join(root, demoMarker), result);
    return result;
  } finally {
    owner?.close();
  }
}
