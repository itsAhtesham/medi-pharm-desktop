import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { WorkspaceStatus, Lifecycle, Result, UpdatePharmacy } from '../contracts/desktop';
import './styles.css';
import { BackupPanel } from './backup-panel';
import { BusinessWorkspace } from './business-workspace';
import { ExportSettings } from './reports';

import { sections, type Section, type NavigationIntent, type Navigate } from './navigation';
import { Dashboard } from './dashboard';
import { Icon, type IconName } from './icons';
import type { BackupStatus } from '../contracts/backup';
const sectionIcons: Record<Section, IconName> = {
  Overview: 'home',
  Customers: 'users',
  Medicines: 'pill',
  Purchases: 'bag',
  'Follow-ups': 'bell',
  Reports: 'chart',
  Settings: 'settings',
};
type Run = <T>(
  action: () => Promise<Result<T>>,
  message?: string | ((value: T) => string),
) => Promise<boolean>;
function recoveryCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

function AccessForm({ setup, busy, run }: { setup: boolean; busy: boolean; run: Run }) {
  const [recover, setRecover] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [oldCode, setOldCode] = useState('');
  const [code, setCode] = useState(recoveryCode);
  const [acknowledged, setAcknowledged] = useState(false);
  const [localError, setLocalError] = useState('');
  const creating = setup || recover;
  return (
    <section className="card access-card">
      <p className="eyebrow">ONE PHARMACY · ONE LOCAL OWNER</p>
      <h1>{setup ? 'Set up your pharmacy' : recover ? 'Recover owner access' : 'Welcome back'}</h1>
      <p className="subtitle">
        {setup
          ? 'Create your owner account. Your workspace starts empty.'
          : recover
            ? 'Use your saved recovery code to choose a new password.'
            : 'Sign in to the pharmacy saved on this computer.'}
      </p>
      {localError && (
        <p role="alert" className="feedback error">
          {localError}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setLocalError('');
          if (creating && password !== confirmation) {
            setLocalError('The passwords do not match.');
            return;
          }
          void (async () => {
            const success = await run(
              () =>
                setup
                  ? window.mediPharm.setup({
                      pharmacyName: name,
                      identifier,
                      password,
                      recoveryCode: code,
                    })
                  : recover
                    ? window.mediPharm.recover({
                        identifier,
                        password,
                        recoveryCode: oldCode,
                        newRecoveryCode: code,
                      })
                    : window.mediPharm.login({ identifier, password }),
              creating ? 'Account saved. Sign in with your owner identifier and password.' : '',
            );
            // Clear secrets after every attempt; never put them in browser storage.
            setPassword('');
            setConfirmation('');
            setOldCode('');
            if (success && recover) {
              setRecover(false);
              setCode(recoveryCode());
              setAcknowledged(false);
            }
          })();
        }}
      >
        <fieldset disabled={busy}>
          {setup && (
            <>
              <label htmlFor="pharmacy-name">Pharmacy name</label>
              <input
                id="pharmacy-name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </>
          )}
          <label htmlFor="owner-id">Owner identifier</label>
          <input
            id="owner-id"
            autoComplete="username"
            required
            minLength={3}
            maxLength={80}
            pattern="[A-Za-z0-9._\-]{3,80}"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            aria-describedby="owner-help"
          />
          <p id="owner-help" className="field-help">
            Use letters, numbers, dots, underscores or hyphens. This is not an email account.
          </p>
          {recover && (
            <>
              <label htmlFor="old-code">Saved recovery code</label>
              <input
                id="old-code"
                autoComplete="off"
                required
                pattern="[a-f0-9]{64}"
                value={oldCode}
                onChange={(e) => setOldCode(e.target.value.trim().toLowerCase())}
              />
            </>
          )}
          <label htmlFor="password">{creating ? 'New password' : 'Password'}</label>
          <input
            id="password"
            type="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            required
            minLength={creating ? 12 : 1}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {creating && (
            <>
              <p className="field-help">
                Use 12–128 characters. Spaces are kept exactly as entered.
              </p>
              <label htmlFor="password-confirmation">Confirm password</label>
              <input
                id="password-confirmation"
                type="password"
                autoComplete="new-password"
                required
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
              <div className="recovery-code">
                <h2>{recover ? 'Your replacement recovery code' : 'Save your recovery code'}</h2>
                <p>
                  Write this code down and keep it somewhere private, separate from this computer.
                  It is the only offline way to reset a forgotten password.
                  {recover && ' Your old code stops working after recovery.'}
                </p>
                <code data-testid="recovery-code">{code}</code>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I have saved this recovery code somewhere safe
              </label>
            </>
          )}
          <button className="primary" type="submit" disabled={creating && !acknowledged}>
            {busy
              ? 'Please wait…'
              : setup
                ? 'Create pharmacy'
                : recover
                  ? 'Reset owner password'
                  : 'Sign in'}
          </button>
        </fieldset>
      </form>
      {!setup && (
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setRecover(!recover);
            setPassword('');
            setConfirmation('');
            setOldCode('');
            setLocalError('');
            setCode(recoveryCode());
            setAcknowledged(false);
          }}
        >
          {recover ? 'Back to sign in' : 'Forgot password?'}
        </button>
      )}
    </section>
  );
}

function PasswordForm({ busy, run }: { busy: boolean; run: Run }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="card">
      <h2>Change owner password</h2>
      <p className="body-copy">
        Changing your password signs you out. Your saved recovery code stays valid.
      </p>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (password !== confirm) {
            setError('The passwords do not match.');
            return;
          }
          void run(
            () => window.mediPharm.changePassword({ currentPassword: current, password }),
            'Password changed. Sign in with your new password.',
          ).then(() => {
            setCurrent('');
            setPassword('');
            setConfirm('');
          });
        }}
      >
        <fieldset disabled={busy}>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            required
            type="password"
            autoComplete="current-password"
            value={current}
            maxLength={128}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            required
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label htmlFor="confirm-new">Confirm new password</label>
          <input
            id="confirm-new"
            required
            type="password"
            autoComplete="new-password"
            value={confirm}
            maxLength={128}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button className="secondary" type="submit">
            Change password
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function App() {
  const [businessDirty, setBusinessDirty] = useState(false);
  const [businessReset, setBusinessReset] = useState(0);
  const [intent, setIntent] = useState<NavigationIntent | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [section, setSection] = useState<Section>('Overview');
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [running, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ name: string; expectedVersion: number } | null>(null);
  const [pending, setPending] = useState<UpdatePharmacy | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const lifecycleRef = useRef<Lifecycle | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [section, intent]);
  const ready = lifecycle?.state === 'ready' || lifecycle?.state === 'maintenance';
  const busy = running || lifecycle?.state === 'maintenance';
  const restored = (backupCreated: boolean) => {
    // Do not discard a new draft if the owner already signed in before this reply.
    if (lifecycleRef.current?.state !== 'ready') {
      setDraft(null);
      setPending(null);
      setSection('Overview');
      setStatus(null);
    }
    setMessage(
      backupCreated
        ? 'Restore completed and a new encrypted backup was verified. Sign in to the restored pharmacy.'
        : 'Restore completed. A new backup was not created; sign in, unlock backups and create one.',
    );
  };
  async function refresh() {
    const revision = lifecycleRef.current?.revision;
    if (lifecycleRef.current?.state !== 'ready') return;
    const [result, backupResult] = await Promise.all([
      window.mediPharm.status(),
      window.mediPharm.backupStatus(),
    ]);
    if (lifecycleRef.current?.revision !== revision || lifecycleRef.current?.state !== 'ready')
      return;
    if (backupResult.ok) setBackup(backupResult.data);
    if (result.ok) setStatus(result.data);
    else setError(result.message);
  }
  useEffect(() => {
    let disposed = false;
    const accept = (next: Lifecycle) => {
      if (disposed || (lifecycleRef.current && next.revision <= lifecycleRef.current.revision))
        return;
      if (next.state === 'maintenance' && next.operation === 'restore') {
        setBusinessReset((value) => value + 1);
        setIntent(null);
        setBusinessDirty(false);
        setDraft(null);
        setPending(null);
      }
      lifecycleRef.current = next;
      setLifecycle(next);
      setError('');
      setMessage('');
      if (next.state === 'ready') void refresh();
      else if (next.state !== 'maintenance') {
        setStatus(null);
        setBackup(null);
      }
    };
    const unsubscribe = window.mediPharm.onLifecycle(accept);
    const sync = () => {
      void window.mediPharm.lifecycle().then((result) => {
        if (disposed) return;
        if (result.ok) {
          accept(result.data);
          if (result.data.state === 'ready') void refresh();
        } else setError(result.message);
      });
    };
    sync();
    window.addEventListener('focus', sync);
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener('focus', sync);
      lifecycleRef.current = null;
    };
  }, []);
  useEffect(() => {
    void window.mediPharm.setDraftDirty(Boolean(draft) || Boolean(pending) || businessDirty);
  }, [draft, pending, businessDirty]);
  const run: Run = async (action, successMessage = '') => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (result.ok) {
        setMessage(
          typeof successMessage === 'function' ? successMessage(result.data) : successMessage,
        );
        await refresh();
        return true;
      }
      setError(result.message);
      return false;
    } catch {
      setError('The desktop connection was interrupted. Reopen local storage before continuing.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function savePharmacy() {
    if (!status || !draft) return;
    const submission = pending ?? {
      ...draft,
      name: draft.name.trim(),
      requestId: crypto.randomUUID(),
    };
    setPending(submission);
    await run(async () => {
      const result = await window.mediPharm.updatePharmacy(submission);
      if (result.ok) {
        setPending(null);
        setDraft(null);
      } else if (result.code === 'CONFLICT' || result.code === 'INVALID_REQUEST') setPending(null);
      return result;
    }, 'Pharmacy details saved on this computer.');
  }
  const navigate: Navigate = (next, action, id) => {
    if (!ready || busy || businessDirty) return;
    setSection(next);
    setIntent(action ? { key: crypto.randomUUID(), action, id } : null);
    setSidebarOpen(false);
  };
  const createBackup = () => {
    if (!backup?.configured || !backup.unlocked) {
      navigate('Settings');
      return;
    }
    void run(() => window.mediPharm.backupCreate(), 'Encrypted backup created and verified.');
  };
  const shortcuts: {
    label: string;
    section: Section;
    action?: NavigationIntent['action'];
    icon: IconName;
  }[] = [
    { label: 'Customer directory', section: 'Customers', icon: 'users' },
    { label: 'Register customer', section: 'Customers', action: 'newCustomer', icon: 'plus' },
    { label: 'Medicine catalog', section: 'Medicines', icon: 'pill' },
    { label: 'Enter purchase', section: 'Purchases', action: 'newPurchase', icon: 'bag' },
    { label: 'Purchase history', section: 'Reports', icon: 'history' },
    { label: 'Due reminders', section: 'Follow-ups', action: 'due', icon: 'bell' },
    { label: 'Upcoming reminders', section: 'Follow-ups', action: 'scheduled', icon: 'clock' },
    { label: 'All follow-up cycles', section: 'Follow-ups', action: 'all', icon: 'activity' },
    { label: 'Backups & exports', section: 'Settings', icon: 'backup' },
  ];
  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="activity" />
          </div>
          <div>
            Medi<span>Pharm</span>
            <small>DESKTOP · PATIENT CARE</small>
          </div>
        </div>
        <div className="header-pharmacy">
          {ready ? (status?.pharmacy.name ?? 'Your pharmacy') : 'Your local pharmacy workspace'}
        </div>
        <div className="header-actions">
          <span className="local-indicator">
            <span className="status-dot" />
            {ready ? 'Local database' : 'Local access'}
          </span>
          {ready && (
            <>
              <span className="owner-label">
                <Icon name="shield" />
                {status?.identifier ?? 'Owner'}
              </span>
              <button
                className="header-lock"
                disabled={busy}
                onClick={() => void run(() => window.mediPharm.logout())}
              >
                <Icon name="lock" />
                Lock workspace
              </button>
            </>
          )}
        </div>
      </header>
      <nav className="top-navigation" aria-label="Main navigation">
        {sections.map((item) => (
          <button
            key={item}
            disabled={!ready || busy || businessDirty}
            aria-current={section === item ? 'page' : undefined}
            onClick={() => navigate(item)}
          >
            <Icon name={sectionIcons[item]} />
            {item}
          </button>
        ))}
      </nav>
      <div className="workspace-body">
        <aside className="sidebar" aria-label="Workspace shortcuts">
          <div className="sidebar-title">
            <Icon name={sectionIcons[section]} />
            {ready ? section : 'MediPharm'}
          </div>
          {shortcuts.map((item, index) => (
            <React.Fragment key={item.label}>
              {(index === 0 || index === 5 || index === 8) && (
                <h2 className="sidebar-group">
                  {index === 0 ? 'CUSTOMER CARE' : index === 5 ? 'REMINDERS' : 'WORKSPACE'}
                </h2>
              )}
              <button
                disabled={!ready || busy || businessDirty}
                onClick={() => navigate(item.section, item.action)}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            </React.Fragment>
          ))}
          <div className="sidebar-bottom">
            <Icon name="shield" />
            <strong>Offline by design</strong>
            <p>One pharmacy. One local owner.</p>
            <small>
              Windows 10 & 11
              <br />
              Development preview
            </small>
          </div>
        </aside>
        <div className="main-layout" ref={contentRef}>
          <div className="workspace-heading">
            <button
              className="sidebar-toggle secondary"
              aria-label="Toggle workspace shortcuts"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Icon name="menu" />
            </button>
            <Icon name={sectionIcons[section]} />
            <h1>{ready ? (section === 'Overview' ? 'Dashboard' : section) : 'Owner access'}</h1>
            <span className="prototype-badge">DEVELOPMENT PREVIEW</span>
          </div>
          <main>
            <div className="notice">
              <span aria-hidden="true">i</span>
              <p>
                <strong>Development preview.</strong> Customer, medicine, purchase and follow-up
                workflows are available for testing. Windows release checks are still pending. Use
                test data for now.
              </p>
            </div>
            {lifecycle?.state === 'maintenance' && (
              <div role="status" className="feedback success">
                {lifecycle.message}
              </div>
            )}
            {error && (
              <div role="alert" className="feedback error">
                {error}
              </div>
            )}
            {message && (
              <div role="status" className="feedback success">
                {message}
              </div>
            )}
            {lifecycle?.state === 'recoveryRequired' ? (
              <>
                <section role="alert" className="card">
                  <h1>Local storage needs attention</h1>
                  <p>{lifecycle.message}</p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void run(() => window.mediPharm.restartStorage())}
                  >
                    Restart storage
                  </button>
                </section>

                <BackupPanel fresh disabled={busy} onRestored={restored} />
              </>
            ) : lifecycle?.state === 'setupRequired' || lifecycle?.state === 'locked' ? (
              <>
                <AccessForm
                  key={lifecycle.state}
                  setup={lifecycle.state === 'setupRequired'}
                  busy={busy}
                  run={run}
                />
                {lifecycle.state === 'setupRequired' && (
                  <BackupPanel fresh disabled={busy} onRestored={restored} />
                )}
              </>
            ) : !ready ? (
              <p role="status">{lifecycle?.message ?? 'Starting your local workspace…'}</p>
            ) : (
              <>
                {!status ? (
                  <p role="status">Loading pharmacy details…</p>
                ) : section === 'Overview' ? (
                  <Dashboard
                    enabled={!busy && !businessDirty}
                    revision={status.revision}
                    pharmacy={status.pharmacy.name}
                    onNavigate={navigate}
                    onBackup={createBackup}
                  />
                ) : section === 'Settings' ? (
                  <>
                    <div className="content-grid">
                      <section className="card">
                        <h2>Pharmacy details</h2>
                        <p className="body-copy">Business dates use Asia/Kolkata.</p>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void savePharmacy();
                          }}
                        >
                          <label htmlFor="settings-name">Pharmacy name</label>
                          <input
                            id="settings-name"
                            maxLength={120}
                            required
                            disabled={busy || Boolean(pending)}
                            value={pending?.name ?? draft?.name ?? status.pharmacy.name}
                            onChange={(e) =>
                              setDraft({
                                name: e.target.value,
                                expectedVersion: draft?.expectedVersion ?? status.pharmacy.version,
                              })
                            }
                          />
                          <button
                            type="submit"
                            className="primary"
                            disabled={busy || !draft || !draft.name.trim()}
                          >
                            {pending ? 'Retry same save' : 'Save pharmacy details'}
                          </button>
                        </form>
                        {draft && !pending && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setDraft(null);
                              setError('');
                              void refresh();
                            }}
                          >
                            Use saved details
                          </button>
                        )}
                        {pending && (
                          <p className="body-copy">
                            This submission is kept unchanged until the save is confirmed. Sign in
                            again if needed, then retry the same save.
                          </p>
                        )}
                      </section>
                      <PasswordForm busy={busy} run={run} />
                    </div>
                    <ExportSettings disabled={busy} />
                    <BackupPanel disabled={busy} onRestored={restored} onStatusChange={setBackup} />
                  </>
                ) : null}
              </>
            )}
            <div hidden={!ready || section === 'Settings' || section === 'Overview'}>
              <BusinessWorkspace
                key={businessReset}
                section={section}
                active={ready && section !== 'Settings' && section !== 'Overview'}
                intent={intent}
                enabled={lifecycle?.state === 'ready' && !busy}
                epoch={lifecycle?.revision ?? 0}
                onDirty={setBusinessDirty}
                onCommit={() => void refresh()}
              />
            </div>
            <footer>
              <span>Local data · No cloud account</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => window.mediPharm.exportDiagnostics(),
                    (result) =>
                      result.saved ? 'Diagnostics saved.' : 'Diagnostics export cancelled.',
                  )
                }
              >
                Save diagnostics
              </button>
            </footer>
          </main>
        </div>
      </div>
      <div className="status-bar" aria-label="Storage status">
        <span>
          <span className="status-dot" />
          {lifecycle?.state === 'ready'
            ? 'Local database ready'
            : lifecycle?.state === 'maintenance'
              ? 'Storage operation in progress'
              : lifecycle?.state === 'locked'
                ? 'Workspace locked'
                : 'Local owner access'}
        </span>
        <span>{ready ? status?.pharmacy.name : 'MediPharm Desktop'}</span>
        <span className="backup-indicator">
          {!ready
            ? 'Offline workspace'
            : !backup
              ? 'Checking backup status…'
              : !backup.configured
                ? 'Backups not configured'
                : !backup.localLast
                  ? 'No verified backup yet'
                  : `Last verified backup: ${new Date(backup.localLast).toLocaleString()}`}
          {ready && backup?.externalPending ? ' · External copy pending' : ''}
        </span>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
