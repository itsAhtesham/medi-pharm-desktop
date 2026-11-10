import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { WorkspaceStatus, Lifecycle, Result, UpdatePharmacy } from '../contracts/desktop';
import './styles.css';
import { BackupPanel } from './backup-panel';
import { BusinessWorkspace } from './business-workspace';
import { ExportSettings } from './reports';

const sections = [
  'Overview',
  'Customers',
  'Medicines',
  'Purchases',
  'Follow-ups',
  'History',
  'Settings',
] as const;
type Section = (typeof sections)[number];
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
  const [section, setSection] = useState<Section>('Overview');
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [running, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ name: string; expectedVersion: number } | null>(null);
  const [pending, setPending] = useState<UpdatePharmacy | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const lifecycleRef = useRef<Lifecycle | null>(null);
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
    const result = await window.mediPharm.status();
    if (lifecycleRef.current?.revision !== revision || lifecycleRef.current?.state !== 'ready')
      return;
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
        setBusinessDirty(false);
        setDraft(null);
        setPending(null);
      }
      lifecycleRef.current = next;
      setLifecycle(next);
      setError('');
      setMessage('');
      if (next.state === 'ready') void refresh();
      else if (next.state !== 'maintenance') setStatus(null);
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
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            ✚
          </div>
          <div>
            MediPharm<small>DESKTOP</small>
          </div>
        </div>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {sections.map((item, index) => (
            <button
              key={item}
              disabled={!ready || busy || businessDirty}
              aria-current={section === item ? 'page' : undefined}
              onClick={() => setSection(item)}
            >
              <span className="nav-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          Offline by design
          <small>
            Windows 10 & 11
            <br />
            Development preview
          </small>
        </div>
      </aside>
      <div className="main-layout">
        <header className="topbar">
          <div>
            {ready ? (status?.pharmacy.name ?? 'Your pharmacy') : 'Local owner access'}{' '}
            <span>/</span> <strong>{ready ? section : 'MediPharm'}</strong>
          </div>
          <div className="header-actions">
            <span className="prototype-badge">DEVELOPMENT PREVIEW</span>
            {ready && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void run(() => window.mediPharm.logout())}
              >
                Lock workspace
              </button>
            )}
          </div>
        </header>
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
              <div className="page-heading">
                <div>
                  <p className="eyebrow">YOUR PHARMACY, LOCALLY</p>
                  <h1>{section === 'Overview' ? 'Your pharmacy today.' : section}</h1>
                  <p className="subtitle">
                    {section === 'Overview'
                      ? 'Review customer reminders and record today’s supplies.'
                      : section === 'Settings'
                        ? 'Manage your pharmacy and local owner access.'
                        : 'Saved locally on this computer. Business dates use Asia/Kolkata.'}
                  </p>
                </div>
              </div>
              {!status ? (
                <p role="status">Loading pharmacy details…</p>
              ) : section === 'Overview' ? (
                <>
                  <div className="summary-grid">
                    {(['customers', 'medicines', 'purchases'] as const).map((kind) => (
                      <article className="summary-card" key={kind}>
                        <p>{kind[0].toUpperCase() + kind.slice(1)}</p>
                        <strong data-testid={`${kind}-count`}>{status[kind]}</strong>
                        <span>No sample records are imported</span>
                      </article>
                    ))}
                  </div>
                  <section className="card">
                    <h2>Welcome to {status.pharmacy.name}</h2>
                    <p className="body-copy">
                      You are signed in as <strong>{status.identifier}</strong>. Customer records,
                      medicine supplies and follow-ups are available in the workspace.
                    </p>
                    <button
                      className="primary"
                      disabled={businessDirty || busy}
                      onClick={() => setSection('Settings')}
                    >
                      Open pharmacy settings
                    </button>
                  </section>
                </>
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
                  <BackupPanel disabled={busy} onRestored={restored} />
                </>
              ) : null}
            </>
          )}
          <div hidden={!ready || section === 'Settings'}>
            <BusinessWorkspace
              key={businessReset}
              section={section}
              active={ready && section !== 'Settings'}
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
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
