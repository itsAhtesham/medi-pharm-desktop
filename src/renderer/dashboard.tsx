import React, { useEffect, useState } from 'react';
import type { DashboardData } from '../contracts/dashboard';
import { Icon, type IconName } from './icons';
import type { Navigate } from './navigation';
export function Dashboard({
  enabled,
  revision,
  pharmacy,
  onNavigate,
  onBackup,
}: {
  enabled: boolean;
  revision: number;
  pharmacy: string;
  onNavigate: Navigate;
  onBackup: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void window.mediPharm.dashboard().then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data);
        setError('');
      } else {
        setError(r.message);
        setData(null);
      }
    });
    return () => {
      live = false;
    };
  }, [enabled, revision, tick]);
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const actions: { label: string; icon: IconName; run: () => void; color: string }[] = [
    {
      label: 'New customer',
      icon: 'users',
      run: () => onNavigate('Customers', 'newCustomer'),
      color: 'blue',
    },
    {
      label: 'New medicine',
      icon: 'pill',
      run: () => onNavigate('Medicines', 'newMedicine'),
      color: 'green',
    },
    {
      label: 'Record purchase',
      icon: 'bag',
      run: () => onNavigate('Purchases', 'newPurchase'),
      color: 'purple',
    },
    {
      label: 'Due follow-ups',
      icon: 'bell',
      run: () => onNavigate('Follow-ups', 'due'),
      color: 'amber',
    },
    { label: 'Export data', icon: 'download', run: () => onNavigate('Settings'), color: 'cyan' },
    { label: 'Create backup', icon: 'backup', run: onBackup, color: 'blue' },
  ];
  return (
    <div className="dashboard-layout">
      <div className="dashboard-main">
        <div className="dashboard-welcome">
          <h2>Welcome to {pharmacy}</h2>
          <span>{data?.today ?? 'Loading…'} · Asia/Kolkata</span>
          <button className="text-button" disabled={!enabled} onClick={() => setTick((t) => t + 1)}>
            Refresh dashboard
          </button>
        </div>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Loading dashboard…</p>}
        {data && (
          <>
            <div className="dashboard-metrics">
              <Metric
                icon="users"
                color="blue"
                title="Active customers"
                value={data.activeCustomers}
                note="Customer records"
                testId="customers-count"
                onClick={() => onNavigate('Customers')}
                disabled={!enabled}
              />
              <Metric
                icon="bag"
                color="green"
                title="Purchases today"
                value={data.purchasesToday}
                note="Active purchases · excludes cancelled"
                testId="purchases-count"
                onClick={() => onNavigate('Purchases')}
                disabled={!enabled}
              />
              <Metric
                icon="pill"
                color="purple"
                title="Ending within 5 days"
                value={data.endingSupplies}
                note={`${data.endingCustomers} ${data.endingCustomers === 1 ? 'customer' : 'customers'} · medicine supplies`}
                testId="ending-count"
                onClick={() =>
                  document.getElementById('ending-panel')?.scrollIntoView({ block: 'nearest' })
                }
                disabled={!enabled}
              />
              <Metric
                icon="bell"
                color="amber"
                title="Overdue follow-ups"
                value={data.overdueCycles}
                note={`${data.overdueCustomers} ${data.overdueCustomers === 1 ? 'customer' : 'customers'} · medicine reminders`}
                testId="overdue-count"
                onClick={() => onNavigate('Follow-ups', 'due')}
                disabled={!enabled}
              />
            </div>
            <div className="dashboard-middle">
              <section className="panel">
                <PanelTitle icon="chart" title="Purchase activity" subtitle="Last 7 days" />
                <div
                  className="purchase-chart"
                  role="img"
                  aria-label={`Active purchase counts over seven days: ${data.purchasesByDay.map((d) => `${d.day}: ${d.count}`).join(', ')}`}
                >
                  {data.purchasesByDay.map((d) => (
                    <div className="chart-column" key={d.day}>
                      <span className="chart-value">{d.count}</span>
                      <div className="bar-space">
                        <div
                          className={`chart-bar ${d.day === data.today ? 'today' : ''}`}
                          style={{
                            height: `${(d.count / Math.max(1, ...data.purchasesByDay.map((v) => v.count))) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="chart-date">
                        {new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="chart-note">
                  Purchase counts, not revenue. Cancelled purchases are excluded.
                </p>
              </section>
              <section className="panel">
                <PanelTitle icon="activity" title="Workspace summary" />
                <dl className="quick-stats">
                  <div>
                    <dt>
                      <Icon name="pill" />
                      Active medicines
                    </dt>
                    <dd data-testid="medicines-count">{data.activeMedicines}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="bell" />
                      Due & overdue reminders
                    </dt>
                    <dd>{data.dueCycles}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="users" />
                      Customers to contact
                    </dt>
                    <dd>{data.dueCustomers}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="clock" />
                      Scheduled reminders
                    </dt>
                    <dd>{data.scheduledCycles}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="bag" />
                      Purchases in last 7 days
                    </dt>
                    <dd>{data.purchasesByDay.reduce((sum, d) => sum + d.count, 0)}</dd>
                  </div>
                </dl>
                <button
                  className="text-button panel-link"
                  disabled={!enabled}
                  onClick={() => onNavigate('Follow-ups', 'all')}
                >
                  Browse all follow-up cycles <Icon name="arrow" />
                </button>
              </section>
            </div>
            <div className="dashboard-shortcuts">
              {actions.slice(0, 5).map((a) => (
                <button
                  className={`shortcut ${a.color}`}
                  key={a.label}
                  disabled={!enabled}
                  onClick={a.run}
                >
                  <Icon name={a.icon} />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
            <div className="dashboard-tables">
              <section className="panel" id="ending-panel">
                <PanelTitle
                  icon="pill"
                  title="Medicines ending soon"
                  subtitle="Current coverage · 0–5 days"
                />
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Medicine</th>
                        <th>Run-out</th>
                        <th>Days left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ending.map((r, i) => (
                        <tr key={i}>
                          <td>
                            <button
                              className="table-link"
                              disabled={!enabled}
                              onClick={() => onNavigate('Customers', 'supplies', r.customerId)}
                            >
                              {r.customer}
                            </button>
                          </td>
                          <td>{r.medicine}</td>
                          <td className="date-cell">{r.runOut}</td>
                          <td>
                            <span
                              className={`status-chip ${r.daysLeft === 0 ? 'danger' : 'warning'}`}
                            >
                              {r.daysLeft}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!data.ending.length && (
                        <EmptyRow
                          columns={4}
                          text="No current supplies run out in the next five days."
                        />
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="panel-footnote">
                  Showing up to 6 medicine supplies. Select a customer to review planned refills.
                </p>
              </section>
              <section className="panel">
                <PanelTitle
                  icon="bell"
                  title="Due & overdue"
                  action={() => onNavigate('Follow-ups', 'due')}
                  disabled={!enabled}
                />
                <ReminderTable
                  rows={data.due}
                  today={data.today}
                  enabled={enabled}
                  onNavigate={onNavigate}
                />
              </section>
            </div>
            <section className="panel upcoming-panel">
              <PanelTitle
                icon="clock"
                title="Upcoming reminders"
                action={() => onNavigate('Follow-ups', 'scheduled')}
                disabled={!enabled}
              />
              <ReminderTable
                rows={data.upcoming}
                today={data.today}
                enabled={enabled}
                onNavigate={onNavigate}
              />
            </section>
            <section className="panel recent-panel">
              <PanelTitle icon="history" title="Recent activity" />
              <ul className="recent-list">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <span className="activity-dot" />
                    <div>
                      <strong>{activityLabel[r.action]}</strong>
                      <span>{r.label}</span>
                    </div>
                    <time dateTime={new Date(r.at).toISOString()}>
                      {new Date(r.at).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </li>
                ))}
                {!data.recent.length && (
                  <li>No saved activity yet. Start by adding a customer or medicine.</li>
                )}
              </ul>
            </section>
          </>
        )}
      </div>
      <aside className="quick-actions panel" aria-label="Quick actions">
        <PanelTitle icon="activity" title="Quick actions" />
        {actions.map((a) => (
          <button
            key={a.label}
            className={`quick-action ${a.color}`}
            disabled={!enabled}
            onClick={a.run}
          >
            <Icon name={a.icon} />
            <span>{a.label}</span>
            <Icon name="arrow" />
          </button>
        ))}
        <div className="quick-action-note">
          <Icon name="shield" />
          <strong>Your pharmacy, on this computer</strong>
          <p>All changes are saved locally. Keep a verified backup on a separate drive.</p>
        </div>
      </aside>
    </div>
  );
}
const activityLabel: Record<DashboardData['recent'][number]['action'], string> = {
  'business.customer': 'Customer saved',
  'business.medicine': 'Medicine saved',
  'business.purchase': 'Purchase saved',
  'business.cancel': 'Purchase cancelled',
  'business.followup': 'Follow-up recorded',
};
function Metric({
  icon,
  color,
  title,
  value,
  note,
  testId,
  onClick,
  disabled,
}: {
  icon: IconName;
  color: string;
  title: string;
  value: number;
  note: string;
  testId: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button className={`metric-card ${color}`} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
      <div>
        <span>{title}</span>
        <strong data-testid={testId}>{value}</strong>
        <small>{note}</small>
      </div>
    </button>
  );
}
function PanelTitle({
  icon,
  title,
  subtitle,
  action,
  disabled,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  action?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="panel-title">
      <Icon name={icon} />
      <h2>
        {title} {subtitle && <small>{subtitle}</small>}
      </h2>
      {action && (
        <button className="text-button" disabled={disabled} onClick={action}>
          View all <Icon name="arrow" />
        </button>
      )}
    </div>
  );
}
function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return (
    <tr>
      <td colSpan={columns} className="empty-cell">
        {text}
      </td>
    </tr>
  );
}
function ReminderTable({
  rows,
  today,
  enabled,
  onNavigate,
}: {
  rows: DashboardData['due'];
  today: string;
  enabled: boolean;
  onNavigate: Navigate;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Customer / medicine</th>
            <th>Contact date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  className="table-link"
                  disabled={!enabled}
                  onClick={() => onNavigate('Customers', 'supplies', r.customer_id)}
                >
                  {r.customer_name}
                </button>
                <small className="cell-detail">{r.medicine_name}</small>
              </td>
              <td className="date-cell">{r.next_date}</td>
              <td>
                <span
                  className={`status-chip ${r.next_date < today ? 'danger' : r.next_date === today ? 'warning' : 'info'}`}
                >
                  {r.next_date < today ? 'Overdue' : r.next_date === today ? 'Today' : 'Scheduled'}
                </span>
              </td>
            </tr>
          ))}
          {!rows.length && <EmptyRow columns={3} text="No matching reminders. All caught up." />}
        </tbody>
      </table>
    </div>
  );
}
