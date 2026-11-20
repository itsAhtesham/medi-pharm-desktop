import React, { useEffect, useRef, useState } from 'react';
import { BackButton } from './back-button';
import type { CsvInput, SupplyResult } from '../contracts/reports';

export function CsvButton({
  selection,
  disabled,
  label = 'Export CSV',
  onBusy,
}: {
  selection: CsvInput;
  disabled: boolean;
  label?: string;
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const gate = useRef(false);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  return (
    <div className="csv-control">
      <button
        className="secondary"
        disabled={disabled || busy}
        onClick={() => {
          if (gate.current) return;
          gate.current = true;
          setBusy(true);
          setError('');
          setMessage('');
          void window.mediPharm
            .exportCsv(selection)
            .then((r) => {
              if (r.ok)
                setMessage(
                  r.data.saved ? `CSV saved: ${r.data.rows} data rows.` : 'CSV export cancelled.',
                );
              else setError(r.message);
            })
            .catch(() =>
              setError(
                'Export confirmation was interrupted. Check the destination before exporting again.',
              ),
            )
            .finally(() => {
              gate.current = false;
              setBusy(false);
            });
        }}
      >
        {busy ? 'Exporting…' : label}
      </button>
      {message && (
        <p role="status" className="field-help csv-feedback">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
    </div>
  );
}
export function ExportSettings({
  disabled,
  onBusy,
}: {
  disabled: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState<CsvInput['kind']>('customers');
  const [exportBusy, setExportBusy] = useState(false);
  useEffect(() => {
    onBusy?.(exportBusy);
    return () => onBusy?.(false);
  }, [exportBusy, onBusy]);
  return (
    <section className="card export-settings">
      <h2 tabIndex={-1}>CSV exports</h2>
      <p className="body-copy">
        Export all records, including archived catalogue entries and cancelled purchases. Purchase
        exports have one row per quantity/unit; follow-up history has one row per event. These
        spreadsheets contain customer data and are not encrypted backups.
      </p>
      <label htmlFor="csv-kind">Records to export</label>
      <select
        id="csv-kind"
        value={kind}
        disabled={disabled || exportBusy}
        onChange={(e) => setKind(e.target.value as CsvInput['kind'])}
      >
        <option value="customers">Customers</option>
        <option value="medicines">Medicines</option>
        <option value="purchases">Purchases and items</option>
        <option value="followups">Follow-up cycles</option>
        <option value="followupHistory">Contact and follow-up history</option>
      </select>
      <CsvButton key={kind} selection={{ kind }} disabled={disabled} onBusy={setExportBusy} />
    </section>
  );
}
const coverageLabel = {
  notStarted: 'Not started',
  available: 'Estimated coverage',
  runsOutToday: 'Runs out today',
  ranOut: 'Estimated supply exhausted',
};
const reminderLabel = {
  disabled: 'Reminder disabled',
  due: 'Due today',
  overdue: 'Overdue',
  scheduled: 'Scheduled',
  closed: 'Manually closed',
};
export function CustomerSupplies({
  customerId,
  enabled,
  revision,
  onClose,
  onPurchase,
  backDestination = 'customers',
}: {
  customerId: string;
  enabled: boolean;
  revision: number;
  onClose: () => void;
  onPurchase: (id: string) => void;
  backDestination?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const [data, setData] = useState<SupplyResult | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.mediPharm.customerSupplies({ customerId, search, page }).then((r) => {
        if (!live) return;
        if (r.ok) {
          setData(r.data);
          setError('');
        } else {
          setData(null);
          setError(r.message);
        }
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [customerId, enabled, revision, search, page, tick]);
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return (
    <section className="card customer-supplies" aria-label="Current medicine supplies">
      <BackButton destination={backDestination} onClick={onClose} />
      <div className="record-row">
        <div>
          <h2 ref={heading} tabIndex={-1}>
            Current supplies{data ? ` · ${data.customer.name}` : ''}
          </h2>
          {data && (
            <p>
              As of {data.today} · Asia/Kolkata
              {data.customer.archived_at !== null ? ' · Archived customer' : ''}
            </p>
          )}
        </div>
      </div>
      <p className="body-copy">
        Estimates use the recorded days of supply, not a count of medicines on hand. Future supplies
        are listed separately from coverage available today. Cancelled purchases and removed
        medicines are excluded.
      </p>
      <label htmlFor={`supply-search-${customerId}`}>Search current medicines</label>
      <input
        id={`supply-search-${customerId}`}
        value={search}
        maxLength={120}
        disabled={!enabled}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
          setData(null);
        }}
        placeholder="Medicine name, strength or form"
      />
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading supplies…</p>}
      {data && (
        <>
          <div className="record-list">
            {data.supplies.map((s) => (
              <article className="supply-report-row" key={s.medicineId}>
                <h3>
                  {s.name} {s.strength} · {s.form}
                  {s.archived ? ' · Archived medicine' : ''}
                </h3>
                <div className="supply-report-grid">
                  <div>
                    <h4>Coverage today</h4>
                    <strong>{coverageLabel[s.coverage]}</strong>
                    {s.coverageRunOut ? (
                      <p>
                        {s.remainingDays} estimated days remaining · Run-out {s.coverageRunOut}
                      </p>
                    ) : (
                      <p>No supply has started yet.</p>
                    )}
                    {s.nextStart && <p>Next recorded supply starts {s.nextStart}</p>}
                  </div>
                  <div>
                    <h4>Latest recorded supply</h4>
                    <p>
                      Start {s.start} · {s.newDays} new + {s.carriedDays} carried days
                    </p>
                    <p>Run-out {s.runOut}</p>
                    <button
                      className="text-button"
                      disabled={!enabled}
                      onClick={() => onPurchase(s.purchaseId)}
                    >
                      View source purchase #{s.sequence}
                    </button>
                  </div>
                  <div>
                    <h4>Latest supply reminder</h4>
                    <strong>{reminderLabel[s.reminder]}</strong>
                    {s.nextContact && <p>Next contact {s.nextContact}</p>}
                    {s.lastContact && (
                      <p>Last contacted {new Date(s.lastContact).toLocaleString()}</p>
                    )}
                    {s.closureReason && <p>{s.closureReason}</p>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {data.total === 0 && <p>No matching supplies from active purchases.</p>}
          <div className="business-actions pagination">
            <button
              className="secondary"
              disabled={!enabled || page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous medicines
            </button>
            <span>
              Page {page + 1} · {data.total} medicines
            </span>
            <button
              className="secondary"
              disabled={!enabled || (page + 1) * 20 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Next medicines
            </button>
            <button className="secondary" disabled={!enabled} onClick={() => setTick((t) => t + 1)}>
              Refresh supplies
            </button>
          </div>
        </>
      )}
    </section>
  );
}
