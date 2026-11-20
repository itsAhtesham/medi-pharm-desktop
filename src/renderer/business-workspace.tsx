import { DateInput } from './date-input';
import { BackButton } from './back-button';
import { DraftNavigationDialog } from './draft-navigation-dialog';
import type { NavigationIntent } from './navigation';
import { CsvButton, CustomerSupplies } from './reports';
import React, { useEffect, useRef, useState, useId } from 'react';
import {
  units,
  businessMutationSchema,
  purchaseDraftSchema,
  type BusinessData,
  type BusinessMutation,
  type Customer,
  type Medicine,
  type Purchase,
  type PurchaseDraft,
  type Preview,
  type FollowUp,
  type BusinessQuery,
} from '../contracts/business';
import { pharmacyDay } from '../domain/values';
type CatalogDraft = Extract<BusinessMutation, { kind: 'customer' | 'medicine' }>;
type Editor =
  | { type: 'catalog'; value: CatalogDraft; inline: boolean }
  | { type: 'purchase'; value: PurchaseDraft }
  | { type: 'cancel'; purchase: Purchase; reason: string; revision: number }
  | {
      type: 'followup';
      follow: FollowUp;
      action: 'contact' | 'snooze' | 'close' | 'reopen';
      note: string;
      date: string;
    };
const freshCatalog = (kind: 'customer' | 'medicine'): CatalogDraft =>
  kind === 'customer'
    ? {
        kind,
        id: null,
        expectedVersion: null,
        requestId: crypto.randomUUID(),
        name: '',
        phone: '',
        age: null,
        notes: '',
        archived: false,
      }
    : {
        kind,
        id: null,
        expectedVersion: null,
        requestId: crypto.randomUUID(),
        name: '',
        strength: '',
        form: 'tablet',
        archived: false,
      };
const freshPurchase = (): PurchaseDraft => ({
  id: null,
  expectedVersion: null,
  customerId: '',
  date: pharmacyDay(Date.now()),
  notes: '',
  reason: '',
  items: [],
  supplies: [],
});
const labelMedicine = (m: Medicine) => [m.name, m.strength, m.form].filter(Boolean).join(' · ');
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="business-field">
      <label htmlFor={id}>{label}</label>
      {React.isValidElement<{ id?: string }>(children)
        ? React.cloneElement(children, { id })
        : children}
    </div>
  );
}
function Picker({
  kind,
  onPick,
  onCreate,
}: {
  kind: 'customers' | 'medicines';
  onPick: (row: Customer | Medicine) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<BusinessData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void window.mediPharm.businessQuery({ kind, search, page }).then((r) => {
        if (!live) return;
        if (r.ok) {
          setData(r.data);
          setError('');
        } else setError(r.message);
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, search, page]);
  return (
    <div className="picker">
      <Field label={`Find ${kind}`}>
        <input
          value={search}
          maxLength={120}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
            setData(null);
          }}
          placeholder={kind === 'customers' ? 'Name or phone' : 'Name, strength or form'}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <div className="picker-results">
        {data?.[kind].map((row) => (
          <button className="secondary" type="button" key={row.id} onClick={() => onPick(row)}>
            {'phone' in row ? `${row.name} · ${row.phone}` : labelMedicine(row)}
          </button>
        ))}
        {data?.total === 0 && <p>No matches.</p>}
      </div>
      <div className="business-actions">
        <button
          type="button"
          className="text-button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous matches
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!data || (page + 1) * 20 >= data.total}
          onClick={() => setPage(page + 1)}
        >
          More matches
        </button>
        <button className="secondary" type="button" onClick={onCreate}>
          Add {kind === 'customers' ? 'customer' : 'medicine'} here
        </button>
      </div>
    </div>
  );
}
export function BusinessWorkspace({
  section,
  intent,
  active,
  enabled,
  epoch,
  onDirty,
  onBlocked,
  onCommit,
}: {
  section: string;
  intent: NavigationIntent | null;
  active: boolean;
  enabled: boolean;
  epoch: number;
  onDirty: (dirty: boolean) => void;
  onBlocked: (blocked: boolean) => void;
  onCommit: () => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [archived, setArchived] = useState(false);
  const [tab, setTab] = useState<'due' | 'scheduled' | 'closed' | 'all'>('due');
  const [data, setData] = useState<BusinessData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [tick, setTick] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [backRequested, setBackRequested] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const catalogBaseline = useRef<CatalogDraft | null>(null);
  const purchaseBaseline = useRef<PurchaseDraft | null>(null);
  const [parent, setParent] = useState<PurchaseDraft | null>(null);
  const [pending, setPending] = useState<BusinessMutation | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [detailOrigin, setDetailOrigin] = useState<'list' | 'history' | 'supplies'>('list');
  const [historyFilter, setHistoryFilter] = useState<{
    customerId?: string;
    medicineId?: string;
    label: string;
  } | null>(null);
  const [supplyCustomer, setSupplyCustomer] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<string | undefined>();
  const epochRef = useRef(epoch);
  epochRef.current = epoch;
  const kind: BusinessQuery['kind'] =
    section === 'Customers'
      ? 'customers'
      : section === 'Medicines'
        ? 'medicines'
        : section === 'Purchases'
          ? 'purchases'
          : section === 'Reports'
            ? auditId
              ? 'history'
              : 'purchases'
            : 'followups';
  const dirty = editor !== null || pending !== null;
  useEffect(() => {
    setBackRequested(false);
  }, [enabled, active, epoch]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => onBlocked(working || pending !== null), [working, pending, onBlocked]);
  useEffect(() => {
    setPage(0);
    setSearch('');
    setDetail(null);
    setHistoryFilter(null);
    setSupplyCustomer(null);
    setAuditId(undefined);
    setData(null);
  }, [section]);
  const consumedIntent = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !enabled || !intent || consumedIntent.current === intent.key) return;
    consumedIntent.current = intent.key;
    setPage(0);
    setSearch('');
    setError('');
    setMessage('');
    setPreview(null);
    if (intent.action === 'newCustomer' || intent.action === 'newMedicine') {
      const value = freshCatalog(intent.action === 'newCustomer' ? 'customer' : 'medicine');
      catalogBaseline.current = value;
      setEditor({ type: 'catalog', inline: false, value });
    }
    if (intent.action === 'newPurchase') {
      const value = freshPurchase();
      purchaseBaseline.current = value;
      setEditor({ type: 'purchase', value });
    }
    if (intent.action === 'due' || intent.action === 'scheduled' || intent.action === 'all')
      setTab(intent.action);
    if (intent.action === 'supplies' && intent.id) setSupplyCustomer(intent.id);
  }, [intent, active, enabled]);
  useEffect(() => {
    if (!active || !enabled) return;
    let live = true;
    const generation = epoch;
    const timer = setTimeout(() => {
      void window.mediPharm
        .businessQuery({
          kind,
          search,
          page,
          archived,
          tab,
          ...(historyFilter
            ? { customerId: historyFilter.customerId, medicineId: historyFilter.medicineId }
            : {}),
          id: auditId,
        })
        .then((r) => {
          if (!live || epochRef.current !== generation) return;
          if (r.ok) setData(r.data);
          else setError(r.message);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, enabled, epoch, kind, search, page, archived, tab, tick, historyFilter, auditId]);
  useEffect(() => {
    const sync = () => setTick((t) => t + 1);
    window.addEventListener('focus', sync);
    const timer = setInterval(sync, 60000);
    return () => {
      window.removeEventListener('focus', sync);
      clearInterval(timer);
    };
  }, []);
  const begin = (e: Editor) => {
    if (e.type === 'catalog') catalogBaseline.current = e.value;
    if (e.type === 'purchase') purchaseBaseline.current = e.value;
    setEditor(e);
    setError('');
    setMessage('');
    setPreview(null);
  };
  const changePurchase = (value: PurchaseDraft, resetLate = true) => {
    setEditor({
      type: 'purchase',
      value: resetLate
        ? { ...value, supplies: value.supplies.map((s) => ({ ...s, confirmLate: false })) }
        : value,
    });
    setPreview(null);
  };
  async function save(command: BusinessMutation) {
    if (working) return;
    const validated = businessMutationSchema.safeParse(command);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      setError(`${issue.path.join(' → ')}: ${issue.message}`);
      return;
    }
    command = validated.data;
    setWorking(true);
    setError('');
    setMessage('');
    setPending(command);
    try {
      const r = await window.mediPharm.businessSave(command);
      if (!r.ok) {
        setError(r.message);
        if (r.code !== 'OUTCOME_UNKNOWN' && r.code !== 'NOT_READY' && r.code !== 'AUTH_REQUIRED') {
          setPending(null);
          if (r.code === 'CONFLICT') setPreview(null);
        }
        return;
      }
      setPending(null);
      setPreview(null);
      setDetail(null);
      setMessage(
        parent && (command.kind === 'customer' || command.kind === 'medicine')
          ? `${command.kind === 'customer' ? 'Customer' : 'Medicine'} saved. Continue the purchase draft.`
          : 'Saved on this computer.',
      );
      setTick((t) => t + 1);
      onCommit();
      if (parent && (command.kind === 'customer' || command.kind === 'medicine')) {
        setLabels((l) => ({
          ...l,
          [r.data.id]:
            command.kind === 'customer'
              ? command.name
              : [command.name, command.strength, command.form].filter(Boolean).join(' · '),
        }));
        const p =
          command.kind === 'customer'
            ? { ...parent, customerId: r.data.id }
            : addMedicine(parent, r.data.id);
        setEditor({ type: 'purchase', value: p });
        setParent(null);
      } else setEditor(null);
    } finally {
      setWorking(false);
    }
  }
  function addMedicine(p: PurchaseDraft, id: string): PurchaseDraft {
    return {
      ...p,
      items: [...p.items, { medicineId: id, quantity: '1', unit: 'tablets' }],
      supplies: p.supplies.some((s) => s.medicineId === id)
        ? p.supplies
        : [
            ...p.supplies,
            {
              medicineId: id,
              start: p.date,
              days: 0,
              mode: null,
              remaining: null,
              reminder: false,
              manualDate: null,
              confirmLate: false,
            },
          ],
    };
  }
  function editPurchase(p: Purchase) {
    setLabels((l) => ({
      ...l,
      [p.customer_id]: p.customer_name,
      ...Object.fromEntries(
        p.items.map((i) => [
          i.medicine_id,
          [i.name_snapshot, i.strength_snapshot, i.form_snapshot].join(' · '),
        ]),
      ),
    }));
    begin({
      type: 'purchase',
      value: {
        id: p.id,
        expectedVersion: p.version,
        customerId: p.customer_id,
        date: p.purchase_date,
        notes: p.notes,
        reason: '',
        items: p.items.map((i) => ({
          medicineId: i.medicine_id,
          quantity: String(i.quantity_milli / 1000),
          unit: i.unit,
        })),
        supplies: p.supplies.map((s) => ({
          medicineId: s.medicine_id,
          start: s.start_date,
          days: s.new_days,
          mode: s.mode,
          remaining: s.remaining_override,
          reminder: Boolean(s.reminder_enabled),
          manualDate: s.manual_reminder_date,
          confirmLate: false,
        })),
      },
    });
  }
  async function previewPurchase(p: PurchaseDraft) {
    const validated = purchaseDraftSchema.safeParse(p);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      setError(`${issue.path.join(' → ')}: ${issue.message}`);
      return;
    }
    setWorking(true);
    setError('');
    const generation = epoch;
    try {
      const r = await window.mediPharm.purchasePreview(p);
      if (epochRef.current !== generation) return;
      if (r.ok) setPreview(r.data);
      else setError(r.message);
    } finally {
      setWorking(false);
    }
  }
  const discardEditor = () => {
    setEditor(parent ? { type: 'purchase', value: parent } : null);
    setParent(null);
    setPreview(null);
    setError('');
    setMessage('');
  };
  const blocked = !enabled || working || Boolean(pending);
  const catalog = editor?.type === 'catalog' ? editor.value : null;
  const purchase = editor?.type === 'purchase' ? editor.value : null;
  const listDestination = section.toLowerCase();
  const editorReturnsToDetail = detail && (editor?.type === 'cancel' || Boolean(purchase?.id));
  const editorDestination = parent
    ? 'purchase'
    : editorReturnsToDetail
      ? `purchase #${detail.sequence}`
      : listDestination;
  const detailDestination =
    detailOrigin === 'supplies'
      ? 'current supplies'
      : detailOrigin === 'history'
        ? 'purchase history'
        : listDestination;
  function focusView(selector: string) {
    requestAnimationFrame(() => {
      workspace.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  }
  function openDetail(value: Purchase | null, origin: typeof detailOrigin) {
    setDetailOrigin(origin);
    setDetail(value);
    if (value) focusView('.purchase-detail h2');
  }
  return (
    <div className="business-workspace" ref={workspace}>
      {backRequested && editor && active && enabled && (
        <DraftNavigationDialog
          destination={editorDestination}
          discardParent={false}
          discardLabel="Discard and leave"
          disabled={blocked}
          onContinue={() => setBackRequested(false)}
          onDiscard={() => {
            if (blocked) return;
            setBackRequested(false);
            discardEditor();
            focusView(
              parent
                ? '.business-editor h2'
                : editorReturnsToDetail
                  ? '.purchase-detail h2'
                  : '.business-toolbar input',
            );
          }}
        />
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="feedback success">
          {message}
        </p>
      )}
      {pending && (
        <section className="card">
          <p>
            This submission is frozen until its result is known. Sign in again if needed, then retry
            it unchanged.
          </p>
          <button
            className="primary"
            disabled={!enabled || working}
            onClick={() => void save(pending)}
          >
            Retry same submission
          </button>
        </section>
      )}
      {editor && (
        <section className="card business-editor">
          <BackButton
            destination={editorDestination}
            disabled={blocked}
            onClick={() => setBackRequested(true)}
          />
          <h2 tabIndex={-1}>
            {catalog
              ? `${catalog.id ? 'Edit' : 'Add'} ${catalog.kind}`
              : purchase
                ? purchase.id
                  ? 'Correct purchase'
                  : 'New purchase'
                : editor.type === 'cancel'
                  ? 'Cancel purchase'
                  : 'Update follow-up'}
          </h2>
          <fieldset disabled={blocked}>
            {catalog && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(catalog);
                }}
              >
                <Field label={catalog.kind === 'customer' ? 'Customer name' : 'Medicine name'}>
                  <input
                    required
                    maxLength={120}
                    value={catalog.name}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        value: { ...catalog, name: e.target.value },
                      } as Editor)
                    }
                  />
                </Field>
                {catalog.kind === 'customer' ? (
                  <>
                    <Field label="Phone">
                      <input
                        required
                        maxLength={40}
                        value={catalog.phone}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            value: { ...catalog, phone: e.target.value },
                          } as Editor)
                        }
                      />
                    </Field>
                    <p className="field-help">7–15 digits; family members may share a number.</p>
                    <Field label="Age (optional)">
                      <input
                        type="number"
                        min={0}
                        max={130}
                        value={catalog.age ?? ''}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            value: {
                              ...catalog,
                              age: e.target.value === '' ? null : Number(e.target.value),
                            },
                          } as Editor)
                        }
                      />
                    </Field>
                    <Field label="Customer notes">
                      <textarea
                        maxLength={2000}
                        value={catalog.notes}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            value: { ...catalog, notes: e.target.value },
                          } as Editor)
                        }
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Strength">
                      <input
                        maxLength={80}
                        value={catalog.strength}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            value: { ...catalog, strength: e.target.value },
                          } as Editor)
                        }
                      />
                    </Field>
                    <Field label="Form">
                      <input
                        required
                        maxLength={80}
                        value={catalog.form}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            value: { ...catalog, form: e.target.value },
                          } as Editor)
                        }
                      />
                    </Field>
                    <p className="field-help">
                      Units are selected on each purchase, so one medicine can be supplied in strips
                      or tablets.
                    </p>
                  </>
                )}
                {catalog.id && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={catalog.archived}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          value: { ...catalog, archived: e.target.checked },
                        } as Editor)
                      }
                    />
                    Archived — retain history and exclude from new purchases
                  </label>
                )}
                <div className="business-actions form-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      if (editor.type !== 'catalog' || !catalogBaseline.current) return;
                      setEditor({
                        ...editor,
                        value: { ...catalogBaseline.current, requestId: crypto.randomUUID() },
                      });
                      setError('');
                      setMessage('');
                      setPreview(null);
                    }}
                  >
                    Clear
                  </button>
                  <button className="primary" type="submit" aria-label={`Save ${catalog.kind}`}>
                    Save
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    aria-label={parent ? 'Discard inline changes' : 'Discard draft'}
                    onClick={discardEditor}
                  >
                    Discard
                  </button>
                </div>
              </form>
            )}
            {purchase && (
              <>
                <p className="body-copy">
                  Quantities record what was supplied. Enter days of supply separately; the app does
                  not infer dosage.
                </p>
                <p>
                  <strong>Customer:</strong> {labels[purchase.customerId] ?? 'Choose a customer'}
                </p>
                <Picker
                  kind="customers"
                  onPick={(row) => {
                    setLabels((l) => ({ ...l, [row.id]: row.name }));
                    changePurchase({ ...purchase, customerId: row.id });
                  }}
                  onCreate={() => {
                    setParent(purchase);
                    begin({ type: 'catalog', value: freshCatalog('customer'), inline: true });
                  }}
                />
                <div className="business-grid">
                  <Field label="Purchase date">
                    <DateInput
                      max={pharmacyDay(Date.now())}
                      value={purchase.date}
                      onChange={(e) => changePurchase({ ...purchase, date: e.target.value })}
                    />
                  </Field>
                  <Field label="Purchase notes">
                    <textarea
                      maxLength={2000}
                      value={purchase.notes}
                      onChange={(e) => changePurchase({ ...purchase, notes: e.target.value })}
                    />
                  </Field>
                </div>
                <h3>Medicine quantities</h3>
                {purchase.items.map((item, i) => (
                  <div
                    className="quantity-row"
                    key={i}
                    role="group"
                    aria-label={`Quantity row for ${labels[item.medicineId]}`}
                  >
                    <strong>{labels[item.medicineId]}</strong>
                    <Field label="Quantity">
                      <input
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(e) =>
                          changePurchase({
                            ...purchase,
                            items: purchase.items.map((v, n) =>
                              n === i ? { ...v, quantity: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Unit">
                      <select
                        value={item.unit}
                        onChange={(e) =>
                          changePurchase({
                            ...purchase,
                            items: purchase.items.map((v, n) =>
                              n === i ? { ...v, unit: e.target.value as typeof item.unit } : v,
                            ),
                          })
                        }
                      >
                        {units.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </select>
                    </Field>
                    <button
                      className="text-button"
                      onClick={() => {
                        const items = purchase.items.filter((_, n) => n !== i);
                        changePurchase({
                          ...purchase,
                          items,
                          supplies: purchase.supplies.filter((s) =>
                            items.some((v) => v.medicineId === s.medicineId),
                          ),
                        });
                      }}
                    >
                      Remove row {i + 1}
                    </button>
                  </div>
                ))}
                <Picker
                  kind="medicines"
                  onPick={(row) => {
                    setLabels((l) => ({ ...l, [row.id]: labelMedicine(row as Medicine) }));
                    changePurchase(addMedicine(purchase, row.id));
                  }}
                  onCreate={() => {
                    setParent(purchase);
                    begin({ type: 'catalog', value: freshCatalog('medicine'), inline: true });
                  }}
                />
                <h3>Days of supply and reminders</h3>
                {purchase.supplies.map((s, index) => {
                  const update = (v: Partial<typeof s>, reset = true) =>
                    changePurchase(
                      {
                        ...purchase,
                        supplies: purchase.supplies.map((old, n) =>
                          n === index ? { ...old, ...v } : old,
                        ),
                      },
                      reset,
                    );
                  const estimate = preview?.supplies.find((v) => v.medicineId === s.medicineId);
                  return (
                    <section
                      className="supply-card"
                      key={s.medicineId}
                      aria-label={`Supply for ${labels[s.medicineId]}`}
                    >
                      <h4>{labels[s.medicineId]}</h4>
                      <div className="business-grid">
                        <Field label="Supply start date">
                          <DateInput
                            min={purchase.date}
                            value={s.start}
                            onChange={(e) => update({ start: e.target.value })}
                          />
                        </Field>
                        <Field label="Days supplied">
                          <input
                            type="number"
                            min={1}
                            max={365}
                            value={s.days || ''}
                            onChange={(e) => update({ days: Number(e.target.value) })}
                          />
                        </Field>
                        <Field label="Refill choice">
                          <select
                            value={s.mode ?? ''}
                            onChange={(e) =>
                              update({
                                mode: (e.target.value as 'extend' | 'replace') || null,
                                remaining: null,
                              })
                            }
                          >
                            <option value="" disabled hidden>
                              Choose if a previous supply exists
                            </option>
                            <option value="extend">Extend remaining supply</option>
                            <option value="replace">Replace — start fresh</option>
                          </select>
                        </Field>
                        <Field label="Remaining days adjustment (optional)">
                          <input
                            type="number"
                            min={0}
                            max={365}
                            disabled={s.mode !== 'extend'}
                            value={s.remaining ?? ''}
                            placeholder="Use calculated estimate"
                            onChange={(e) =>
                              update({
                                remaining: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      </div>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={s.reminder}
                          onChange={(e) => update({ reminder: e.target.checked, manualDate: null })}
                        />
                        Enable reminder for {labels[s.medicineId]}
                      </label>
                      {s.reminder && (
                        <>
                          <Field label="Manual reminder date (optional)">
                            <DateInput
                              min={purchase.date}
                              value={s.manualDate ?? ''}
                              onChange={(e) => update({ manualDate: e.target.value || null })}
                            />
                          </Field>
                          {s.manualDate && (
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={s.confirmLate}
                                onChange={(e) => update({ confirmLate: e.target.checked }, false)}
                              />
                              I confirm this date if it falls on or after run-out
                            </label>
                          )}
                        </>
                      )}
                      {estimate && (
                        <p className="supply-estimate">
                          Carry {estimate.remaining} days · Run-out {estimate.runOut} ·{' '}
                          {s.reminder ? `Reminder ${estimate.reminder}` : 'Reminder disabled'}
                        </p>
                      )}
                    </section>
                  );
                })}
                {purchase.id && (
                  <Field label="Correction reason">
                    <textarea
                      required
                      maxLength={2000}
                      value={purchase.reason}
                      onChange={(e) => changePurchase({ ...purchase, reason: e.target.value })}
                    />
                  </Field>
                )}
                <p className="field-help">
                  Corrections recalculate later refills. The previous details remain in audit
                  history.
                </p>
                <p className="field-help">
                  First, click <strong>Refresh supply preview</strong> and review the supply and
                  reminder dates. Then click <strong>Save</strong>. If you change any details,
                  refresh the preview again before saving.
                </p>
                <div className="business-actions">
                  <button className="secondary" onClick={() => void previewPurchase(purchase)}>
                    Refresh supply preview
                  </button>
                </div>
                <div className="business-actions form-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      if (!purchaseBaseline.current) return;
                      changePurchase(purchaseBaseline.current);
                      setError('');
                      setMessage('');
                    }}
                  >
                    Clear
                  </button>
                  <button
                    className="primary"
                    type="button"
                    aria-label="Save purchase"
                    disabled={!preview}
                    onClick={() =>
                      preview &&
                      void save({
                        ...purchase,
                        kind: 'purchase',
                        requestId: crypto.randomUUID(),
                        expectedRevision: preview.revision,
                      })
                    }
                  >
                    Save
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    aria-label="Discard draft"
                    onClick={discardEditor}
                  >
                    Discard
                  </button>
                </div>
              </>
            )}
            {editor.type === 'cancel' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (data)
                    void save({
                      kind: 'cancel',
                      requestId: crypto.randomUUID(),
                      id: editor.purchase.id,
                      expectedVersion: editor.purchase.version,
                      expectedRevision: editor.revision,
                      reason: editor.reason,
                    });
                }}
              >
                <p>
                  Cancel purchase #{editor.purchase.sequence}? Later supply estimates will be
                  recalculated, and the preceding eligible reminder state restored. The purchase
                  stays in history.
                </p>
                <Field label="Cancellation reason">
                  <textarea
                    required
                    maxLength={2000}
                    value={editor.reason}
                    onChange={(e) => setEditor({ ...editor, reason: e.target.value })}
                  />
                </Field>
                <button type="submit" className="primary">
                  Confirm cancellation
                </button>
              </form>
            )}
            {editor.type === 'followup' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({
                    kind: 'followup',
                    requestId: crypto.randomUUID(),
                    id: editor.follow.id,
                    expectedVersion: editor.follow.version,
                    action: editor.action,
                    note: editor.note,
                    date: editor.date || null,
                  });
                }}
              >
                <p>
                  {editor.follow.customer_name} · {editor.follow.medicine_name}
                </p>
                <Field label="Follow-up action">
                  <select
                    value={editor.action}
                    onChange={(e) =>
                      setEditor({ ...editor, action: e.target.value as typeof editor.action })
                    }
                  >
                    {editor.follow.status === 'closed' ? (
                      <option value="reopen">Reopen</option>
                    ) : (
                      <>
                        <option value="contact">Record contact</option>
                        <option value="snooze">Schedule next contact</option>
                        <option value="close">Close with reason</option>
                      </>
                    )}
                  </select>
                </Field>
                {editor.action !== 'reopen' && (
                  <Field
                    label={editor.action === 'close' ? 'Closure reason' : 'Contact outcome / note'}
                  >
                    <textarea
                      maxLength={2000}
                      required={editor.action !== 'snooze'}
                      value={editor.note}
                      onChange={(e) => setEditor({ ...editor, note: e.target.value })}
                    />
                  </Field>
                )}
                {(editor.action === 'contact' || editor.action === 'snooze') && (
                  <Field label="Next contact date (optional for contact)">
                    <DateInput
                      min={pharmacyDay(Date.now())}
                      required={editor.action === 'snooze'}
                      value={editor.date}
                      onChange={(e) => setEditor({ ...editor, date: e.target.value })}
                    />
                  </Field>
                )}
                <p className="field-help">
                  Recording contact keeps the reminder open until a refill or explicit closure.
                </p>
                <button type="submit" className="primary">
                  Save follow-up
                </button>
              </form>
            )}
            {!catalog && !purchase && (
              <button className="text-button" type="button" onClick={discardEditor}>
                Discard {parent ? 'inline changes' : 'draft'}
              </button>
            )}
          </fieldset>
        </section>
      )}
      <div hidden={Boolean(editor)}>
        <div className="business-toolbar">
          <Field label={`Search ${kind === 'followups' ? 'customers' : kind}`}>
            <input
              maxLength={120}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search saved records"
            />
          </Field>
          {(kind === 'customers' || kind === 'medicines') && (
            <>
              <Field label="Record status">
                <select
                  value={archived ? 'archived' : 'active'}
                  onChange={(e) => {
                    setArchived(e.target.value === 'archived');
                    setPage(0);
                  }}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
              <button
                className="primary"
                disabled={!enabled}
                onClick={() =>
                  begin({
                    type: 'catalog',
                    value: freshCatalog(kind === 'customers' ? 'customer' : 'medicine'),
                    inline: false,
                  })
                }
              >
                Add {kind === 'customers' ? 'customer' : 'medicine'}
              </button>
            </>
          )}
          {section === 'Purchases' && (
            <button
              className="primary"
              disabled={!enabled}
              onClick={() => begin({ type: 'purchase', value: freshPurchase() })}
            >
              New purchase
            </button>
          )}
          {kind === 'followups' && (
            <Field label="Follow-up view">
              <select
                value={tab}
                onChange={(e) => {
                  setTab(e.target.value as typeof tab);
                  setPage(0);
                }}
              >
                <option value="due">Due and overdue</option>
                <option value="scheduled">Scheduled</option>
                <option value="closed">Closed / superseded</option>
                <option value="all">All cycles</option>
              </select>
            </Field>
          )}
          <button className="secondary" disabled={!enabled} onClick={() => setTick((t) => t + 1)}>
            Refresh records
          </button>
        </div>
        {(kind === 'customers' ||
          kind === 'medicines' ||
          kind === 'purchases' ||
          kind === 'followups') && (
          <div className="report-exports">
            <p className="field-help">
              Export includes all matching records across pages. CSV files are not encrypted.
            </p>
            <div className="business-actions">
              <CsvButton
                disabled={!enabled}
                selection={
                  kind === 'customers' || kind === 'medicines'
                    ? { kind, search, status: archived ? 'archived' : 'active' }
                    : kind === 'purchases'
                      ? {
                          kind,
                          search,
                          customerId: historyFilter?.customerId,
                          medicineId: historyFilter?.medicineId,
                        }
                      : { kind, search, tab }
                }
              />
              {kind === 'followups' && (
                <CsvButton
                  disabled={!enabled}
                  selection={{ kind: 'followupHistory', search, tab }}
                  label="Export matching follow-up history"
                />
              )}
            </div>
          </div>
        )}
        {supplyCustomer && (
          <CustomerSupplies
            key={supplyCustomer}
            customerId={supplyCustomer}
            enabled={enabled && active}
            revision={data?.revision ?? 0}
            onClose={() => {
              setSupplyCustomer(null);
              if (detailOrigin === 'supplies') setDetail(null);
              focusView('.business-toolbar input');
            }}
            onPurchase={(id) => {
              const generation = epoch;
              void window.mediPharm.businessQuery({ kind: 'purchases', id }).then((r) => {
                if (epochRef.current !== generation) return;
                if (r.ok) openDetail(r.data.purchases[0] ?? null, 'supplies');
                else setError(r.message);
              });
            }}
          />
        )}
        {historyFilter && (
          <p>
            History for {historyFilter.label}{' '}
            <BackButton
              destination={listDestination}
              onClick={() => {
                setHistoryFilter(null);
                if (detailOrigin === 'history') setDetail(null);
                focusView('.business-toolbar input');
              }}
            />
          </p>
        )}
        {!data ? (
          <p>Loading records…</p>
        ) : (
          <>
            {(kind === 'customers' || kind === 'medicines') && (
              <div className="table-scroll panel">
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>{kind === 'customers' ? 'Customer' : 'Medicine'}</th>
                      <th>{kind === 'customers' ? 'Phone / age' : 'Strength / form'}</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data[kind].map((row) => (
                      <React.Fragment key={row.id}>
                        <tr className="record-row">
                          <td>
                            <strong>{row.name}</strong>
                            {'notes' in row && row.notes && (
                              <small className="cell-detail">{row.notes}</small>
                            )}
                          </td>
                          <td>
                            {'phone' in row ? (
                              <p>
                                {row.phone} ·{' '}
                                {row.age === null ? 'Age not recorded' : `Age ${row.age}`}
                              </p>
                            ) : (
                              <p>
                                {row.strength} · {row.form}
                              </p>
                            )}
                          </td>
                          <td>
                            <span className={`status-chip ${row.archived_at ? '' : 'info'}`}>
                              {row.archived_at ? 'Archived' : 'Active'}
                            </span>
                          </td>
                          <td>
                            <div className="business-actions">
                              <button
                                className="secondary"
                                disabled={!enabled}
                                onClick={() =>
                                  begin({
                                    type: 'catalog',
                                    inline: false,
                                    value:
                                      'phone' in row
                                        ? {
                                            kind: 'customer',
                                            requestId: crypto.randomUUID(),
                                            id: row.id,
                                            expectedVersion: row.version,
                                            name: row.name,
                                            phone: row.phone,
                                            age: row.age,
                                            notes: row.notes,
                                            archived: row.archived_at !== null,
                                          }
                                        : {
                                            kind: 'medicine',
                                            requestId: crypto.randomUUID(),
                                            id: row.id,
                                            expectedVersion: row.version,
                                            name: row.name,
                                            strength: row.strength,
                                            form: row.form,
                                            archived: row.archived_at !== null,
                                          },
                                  })
                                }
                              >
                                Edit {kind === 'customers' ? 'customer' : 'medicine'}
                              </button>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setHistoryFilter({
                                    ...('phone' in row
                                      ? { customerId: row.id }
                                      : { medicineId: row.id }),
                                    label: row.name,
                                  });
                                  setDetail(null);
                                }}
                              >
                                View purchases
                              </button>
                              {'phone' in row && (
                                <button
                                  className="secondary"
                                  disabled={!enabled}
                                  onClick={() => {
                                    setSupplyCustomer(row.id);
                                    setDetail(null);
                                  }}
                                >
                                  View current supplies
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {historyFilter &&
                          (historyFilter.customerId === row.id ||
                            historyFilter.medicineId === row.id) && (
                            <tr>
                              <td colSpan={4}>
                                <RelatedPurchases
                                  filter={historyFilter}
                                  onSelect={(p) => openDetail(p, 'history')}
                                />
                              </td>
                            </tr>
                          )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {kind === 'purchases' && (
              <PurchaseList purchases={data.purchases} onSelect={(p) => openDetail(p, 'list')} />
            )}
            {kind === 'followups' && (
              <div className="record-list">
                {[...new Set(data.followups.map((f) => f.customer_id))].map((id) => {
                  const rows = data.followups.filter((f) => f.customer_id === id);
                  return (
                    <section className="card" key={id}>
                      <h2>{rows[0].customer_name}</h2>
                      <p>{rows[0].phone}</p>
                      {rows.map((f) => (
                        <article className="follow-row" key={f.id}>
                          <div>
                            <strong>{f.medicine_name}</strong>
                            <p>
                              {f.status === 'open'
                                ? f.next_date < data.today
                                  ? 'Overdue'
                                  : f.next_date === data.today
                                    ? 'Due today'
                                    : 'Scheduled'
                                : f.status}{' '}
                              · {f.next_date} · Run-out {f.run_out_date}
                            </p>
                            {f.last_contact_at && (
                              <p>
                                Contacted {new Date(f.last_contact_at).toLocaleString()} ·{' '}
                                {f.status === 'open'
                                  ? f.next_date <= data.today
                                    ? 'Follow up again'
                                    : 'Awaiting refill'
                                  : ''}
                              </p>
                            )}
                            {f.closure_reason && <p>{f.closure_reason}</p>}
                          </div>
                          <div className="business-actions">
                            {f.status !== 'superseded' && (
                              <button
                                className="secondary"
                                disabled={!enabled}
                                onClick={() =>
                                  begin({
                                    type: 'followup',
                                    follow: f,
                                    action: f.status === 'closed' ? 'reopen' : 'contact',
                                    note: '',
                                    date: '',
                                  })
                                }
                              >
                                {f.status === 'closed' ? 'Reopen reminder' : 'Record follow-up'}
                              </button>
                            )}
                            {f.status === 'open' && (
                              <button
                                className="primary"
                                disabled={!enabled}
                                onClick={() => {
                                  setLabels((l) => ({
                                    ...l,
                                    [f.customer_id]: f.customer_name,
                                    [f.medicine_id]: f.medicine_name,
                                  }));
                                  begin({
                                    type: 'purchase',
                                    value: addMedicine(
                                      { ...freshPurchase(), customerId: f.customer_id },
                                      f.medicine_id,
                                    ),
                                  });
                                }}
                              >
                                Record refill
                              </button>
                            )}
                            <button className="text-button" onClick={() => setAuditId(f.id)}>
                              Contact history
                            </button>
                          </div>
                          {auditId === f.id && (
                            <>
                              <BackButton
                                destination="follow-ups"
                                onClick={() => {
                                  setAuditId(undefined);
                                  focusView('.business-toolbar input');
                                }}
                              />
                              <AuditHistory id={f.id} />
                            </>
                          )}
                        </article>
                      ))}
                    </section>
                  );
                })}
              </div>
            )}
            {kind === 'history' && <AuditHistory id={auditId!} />}
            {data.total === 0 && (
              <section className="card empty-state">
                <h2>No matching records</h2>
                <p>
                  {kind === 'followups'
                    ? 'Reminders appear after an opted-in medicine supply is saved.'
                    : 'Add a record or change your search.'}
                </p>
              </section>
            )}
            <div className="business-actions pagination">
              <button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous page
              </button>
              <span>
                Page {page + 1} · {data.total} {kind === 'followups' ? 'customers' : 'records'}
              </span>
              <button
                className="secondary"
                disabled={(page + 1) * 20 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Next page
              </button>
            </div>
          </>
        )}
        {detail && (
          <section className="card purchase-detail">
            <BackButton
              destination={detailDestination}
              onClick={() => {
                setDetail(null);
                focusView(
                  detailOrigin === 'supplies'
                    ? '.customer-supplies h2'
                    : detailOrigin === 'history'
                      ? '.related-history'
                      : '.business-toolbar input',
                );
              }}
            />
            <h2 tabIndex={-1}>
              Purchase #{detail.sequence} · {detail.status}
            </h2>
            <p>
              {detail.customer_name} · {detail.purchase_date}
            </p>
            <p>{detail.notes}</p>
            {detail.items.map((i, n) => (
              <p key={n}>
                {i.name_snapshot} {i.strength_snapshot} {i.form_snapshot} —{' '}
                {i.quantity_milli / 1000} {i.unit}
              </p>
            ))}
            {detail.supplies.map((s) => (
              <p key={s.id}>
                Start {s.start_date} · {s.new_days} new + {s.remaining_used} carried days · Run-out{' '}
                {s.run_out_date} · {s.reminder_enabled ? 'Reminder enabled' : 'Reminder disabled'}
              </p>
            ))}
            <div className="business-actions">
              {detail.status === 'active' && (
                <>
                  <button
                    className="secondary"
                    disabled={!enabled}
                    onClick={() => editPurchase(detail)}
                  >
                    Correct purchase
                  </button>
                  <button
                    className="secondary"
                    disabled={!enabled}
                    onClick={() =>
                      data &&
                      begin({
                        type: 'cancel',
                        purchase: detail,
                        reason: '',
                        revision: data.revision,
                      })
                    }
                  >
                    Cancel purchase
                  </button>
                </>
              )}
            </div>
            <AuditHistory id={detail.id} />
          </section>
        )}
      </div>
    </div>
  );
}
function PurchaseList({
  purchases,
  onSelect,
}: {
  purchases: Purchase[];
  onSelect: (p: Purchase) => void;
}) {
  return (
    <div className="table-scroll panel">
      <table>
        <thead>
          <tr>
            <th>Purchase</th>
            <th>Customer</th>
            <th>Date</th>
            <th>Status</th>
            <th>Quantity rows</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {purchases.map((p) => (
            <tr className="record-row" key={p.id}>
              <td>#{p.sequence}</td>
              <td>{p.customer_name}</td>
              <td className="date-cell">{p.purchase_date}</td>
              <td>
                <span className={`status-chip ${p.status === 'active' ? 'info' : 'danger'}`}>
                  {p.status}
                </span>
              </td>
              <td>{p.items.length}</td>
              <td>
                <button className="secondary" onClick={() => onSelect(p)}>
                  View purchase #{p.sequence}
                </button>
              </td>
            </tr>
          ))}
          {!purchases.length && (
            <tr>
              <td colSpan={6} className="empty-cell">
                No purchases match this view.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function RelatedPurchases({
  filter,
  onSelect,
}: {
  filter: { customerId?: string; medicineId?: string };
  onSelect: (p: Purchase) => void;
}) {
  const [data, setData] = useState<BusinessData | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void window.mediPharm
      .businessQuery({
        kind: 'purchases',
        customerId: filter.customerId,
        medicineId: filter.medicineId,
        page,
      })
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setData(r.data);
          setError('');
        } else setError(r.message);
      });
    return () => {
      live = false;
    };
  }, [filter, page]);
  return (
    <div className="related-history" tabIndex={-1}>
      {error && <p role="alert">{error}</p>}
      {data?.total === 0 && <p>No purchases recorded.</p>}
      <PurchaseList purchases={data?.purchases ?? []} onSelect={onSelect} />
      <div className="business-actions">
        <button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>
          Earlier page
        </button>
        <button
          className="secondary"
          disabled={!data || (page + 1) * 20 >= data.total}
          onClick={() => setPage(page + 1)}
        >
          More purchases
        </button>
      </div>
    </div>
  );
}
function AuditHistory({ id }: { id: string }) {
  const [data, setData] = useState<BusinessData | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void window.mediPharm.businessQuery({ kind: 'history', id, page }).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data);
        setError('');
      } else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [id, page]);
  return (
    <details className="audit-history">
      <summary>Audit and contact history</summary>
      {error && <p role="alert">{error}</p>}
      {data?.history.map((h) => (
        <article key={h.id}>
          <strong>{h.action}</strong>
          <p>
            {new Date(h.created_at).toLocaleString()} {h.note}
          </p>
          <details>
            <summary>Saved before and after details</summary>
            <h4>Before</h4>
            <AuditValue value={JSON.parse(h.before_json).value} />
            <h4>After</h4>
            <AuditValue value={JSON.parse(h.after_json).value} />
          </details>
        </article>
      ))}
      <button className="text-button" disabled={!page} onClick={() => setPage(page - 1)}>
        Newer history
      </button>
      <button
        className="text-button"
        disabled={!data || (page + 1) * 20 >= data.total}
        onClick={() => setPage(page + 1)}
      >
        Older history
      </button>
    </details>
  );
}

function AuditValue({ value }: { value: unknown }): React.ReactNode {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value))
    return (
      <div className="audit-items">
        {value.map((v, i) => (
          <div key={i}>
            <AuditValue value={v} />
          </div>
        ))}
      </div>
    );
  if (typeof value === 'object')
    return (
      <dl className="audit-values">
        {Object.entries(value)
          .filter(
            ([k]) =>
              ![
                'id',
                'version',
                'pharmacy_id',
                'created_by',
                'updated_by',
                'name_key',
                'phone_key',
                'identity_key',
                'paused_state',
              ].includes(k) && !k.endsWith('_id'),
          )
          .map(([k, v]) => (
            <div key={k}>
              <dt>
                {k === 'quantity_milli'
                  ? 'Quantity'
                  : k.replace(/_snapshot$/, '').replaceAll('_', ' ')}
              </dt>
              <dd>
                <AuditValue
                  value={
                    k === 'quantity_milli'
                      ? Number(v) / 1000
                      : k.endsWith('_at') && typeof v === 'number'
                        ? new Date(v).toLocaleString()
                        : v
                  }
                />
              </dd>
            </div>
          ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
