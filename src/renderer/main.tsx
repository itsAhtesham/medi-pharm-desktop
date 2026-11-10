import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DesktopStatus, Lifecycle, Result, SaveRecord } from '../contracts/desktop';
import './styles.css';

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
const descriptions: Record<Section, string> = {
  Overview: 'A fresh start for your pharmacy desktop.',
  Customers: 'Customer details, search, and purchase history will be built here.',
  Medicines: 'Your medicine catalog, including strength and form, will be built here.',
  Purchases: 'Purchase entry and independent medicine supply estimates will be built here.',
  'Follow-ups': 'Due reminders, contact history, and refill follow-ups will be built here.',
  History: 'Purchase corrections, cancellations, and dated activity will be built here.',
  Settings: 'Local owner access, pharmacy settings, backups, and CSV exports will be built here.',
};

function App() {
  const [section, setSection] = useState<Section>('Overview');
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('My first desktop test');
  const [pendingSave, setPendingSave] = useState<SaveRecord | null>(null);
  const [savedDraft, setSavedDraft] = useState('My first desktop test');
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const lifecycleRef = useRef<Lifecycle | null>(null);
  const canWrite = lifecycle?.state === 'ready';

  async function refresh() {
    const revision = lifecycleRef.current?.revision;
    const result = await window.mediPharm.status();
    if (lifecycleRef.current?.revision !== revision || lifecycleRef.current?.state !== 'ready')
      return;
    if (result.ok) setStatus(result.data);
    else setError(result.message);
    setLoading(false);
  }
  useEffect(() => {
    let disposed = false;
    const accept = (next: Lifecycle) => {
      if (disposed || (lifecycleRef.current && next.revision <= lifecycleRef.current.revision))
        return;
      lifecycleRef.current = next;
      setLifecycle(next);
      if (next.state === 'ready') void refresh();
      else if (next.state === 'recoveryRequired') {
        setStatus(null);
        setLoading(false);
        setError('');
      }
    };
    const unsubscribe = window.mediPharm.onLifecycle(accept);
    void window.mediPharm.lifecycle().then((result) => {
      if (result.ok) accept(result.data);
      else setError(result.message);
    });
    const refocus = () => {
      void window.mediPharm.lifecycle().then((result) => {
        if (result.ok) {
          accept(result.data);
          if (result.data.state === 'ready') void refresh();
        }
      });
    };
    window.addEventListener('focus', refocus);
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener('focus', refocus);
      lifecycleRef.current = null;
    };
  }, []);
  useEffect(() => {
    void window.mediPharm.setDraftDirty(Boolean(pendingSave) || note.trim() !== savedDraft.trim());
  }, [note, savedDraft, pendingSave]);

  async function run<T>(action: () => Promise<Result<T>>, describe: (value: T) => string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (result.ok) {
        setMessage(describe(result.data));
        await refresh();
      } else setError(result.message);
    } catch {
      setError('The desktop service could not respond. Please restart the prototype.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const submission = pendingSave ?? { requestId: crypto.randomUUID(), note: note.trim() };
    setPendingSave(submission);
    await run(
      async () => {
        const result = await window.mediPharm.saveRecord(submission);
        if (result.ok) {
          setPendingSave(null);
          setNote(submission.note);
          setSavedDraft(submission.note);
        } else if (result.code === 'INVALID_REQUEST' && !pendingSave) setPendingSave(null);
        return result;
      },
      () => 'Sample saved on this computer. Close and reopen the app to check it is still here.',
    );
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
              aria-current={section === item ? 'page' : undefined}
              onClick={() => setSection(item)}
            >
              <span className="nav-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              {item}
              {item !== 'Overview' && <span className="soon-dot" aria-label="Planned" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Local workspace
          <small>
            Windows 10 & 11
            <br />
            Developed on Linux
          </small>
        </div>
      </aside>
      <div className="main-layout">
        <header className="topbar">
          <div>
            Workspace <span>/</span> <strong>{section}</strong>
          </div>
          <span className="prototype-badge">PLATFORM PROTOTYPE</span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">MADE FOR YOUR COMPUTER</p>
              <h1>{section === 'Overview' ? 'Your pharmacy, locally.' : section}</h1>
              <p className="subtitle">{descriptions[section]}</p>
            </div>
            <div className="offline-badge">
              <span className="status-dot" /> Offline by design
            </div>
          </div>
          <div className="notice">
            <span aria-hidden="true">i</span>
            <p>
              <strong>This is the first desktop prototype.</strong> Use synthetic notes only.
              Pharmacy workflows, owner login, and encrypted backups are not available yet.
            </p>
          </div>
          {lifecycle?.state === 'recoveryRequired' && (
            <div role="alert" className="feedback error recovery-panel">
              <div>
                <strong>Local storage needs attention</strong>
                <p>{lifecycle.message}</p>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => window.mediPharm.restartStorage(),
                    (result) =>
                      result.state === 'ready'
                        ? 'Storage restarted. Review your draft before saving.'
                        : result.message,
                  )
                }
              >
                Restart storage
              </button>
            </div>
          )}
          {lifecycle?.state === 'maintenance' && (
            <div role="status" className="feedback success">
              {lifecycle.message}
            </div>
          )}
          {error && lifecycle?.state !== 'recoveryRequired' && (
            <div role="alert" className="feedback error">
              {error}
            </div>
          )}
          {message && lifecycle?.state !== 'maintenance' && (
            <div role="status" className="feedback success">
              {message}
            </div>
          )}
          {section !== 'Overview' ? (
            <section className="card empty-state">
              <div className="empty-icon" aria-hidden="true">
                ◇
              </div>
              <p className="eyebrow">COMING IN A LATER PHASE</p>
              <h2>{section} is planned</h2>
              <p>
                {descriptions[section]}
                <br />
                No business records have been created.
              </p>
              <button className="primary" onClick={() => setSection('Overview')}>
                Back to prototype checks
              </button>
            </section>
          ) : (
            <>
              <div className="summary-grid">
                <article className="summary-card">
                  <p>Local storage</p>
                  <strong>
                    {lifecycle?.state === 'maintenance'
                      ? 'Working…'
                      : loading || lifecycle?.state === 'starting'
                        ? 'Connecting…'
                        : canWrite && status
                          ? 'Connected'
                          : 'Unavailable'}
                  </strong>
                  <span>
                    {status
                      ? `SQLite ${status.sqliteVersion} · ${status.journalMode.toUpperCase()}`
                      : 'Dedicated local service'}
                  </span>
                </article>
                <article className="summary-card">
                  <p>Saved sample records</p>
                  <strong data-testid="record-count">{status?.recordCount ?? '—'}</strong>
                  <span>Synthetic prototype data only</span>
                </article>
                <article className="summary-card">
                  <p>Release target</p>
                  <strong>Windows 10 / 11</strong>
                  <span>
                    {status
                      ? `Running on ${status.platform} · ${status.architecture}`
                      : 'Windows x64 planned'}
                  </span>
                </article>
              </div>
              <div className="content-grid">
                <section className="card">
                  <div className="card-title">
                    <span className="step">01</span>
                    <div>
                      <h2>Check local persistence</h2>
                      <p>Save a sample, then close and reopen the app.</p>
                    </div>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                  >
                    <label htmlFor="sample-note">Sample note</label>
                    <input
                      id="sample-note"
                      maxLength={160}
                      required
                      value={pendingSave?.note ?? note}
                      disabled={busy || Boolean(pendingSave)}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <button
                      className="primary"
                      disabled={busy || !canWrite || !status || !note.trim()}
                      type="submit"
                    >
                      {pendingSave ? 'Retry same save' : 'Save sample record'}
                      <span aria-hidden="true">↗</span>
                    </button>
                  </form>
                  <div className="saved-record">
                    <span className="small-label">LATEST SAVED SAMPLE</span>
                    <p data-testid="last-record">
                      {status?.lastRecord?.note ?? 'Nothing saved yet'}
                    </p>
                    <small>
                      {status?.lastRecord
                        ? new Date(status.lastRecord.savedAt).toLocaleString()
                        : 'Your first sample will appear here.'}
                    </small>
                  </div>
                </section>
                <section className="card">
                  <div className="card-title">
                    <span className="step">02</span>
                    <div>
                      <h2>Check snapshot & restore</h2>
                      <p>Test the storage primitives with synthetic data.</p>
                    </div>
                  </div>
                  <p className="body-copy">
                    Create a raw SQLite snapshot, then open a restored copy in a separate temporary
                    location. Your live sample records stay in place.
                  </p>
                  <div className="stacked-actions">
                    <button
                      className="secondary"
                      disabled={busy || !canWrite || !status}
                      onClick={() =>
                        void run(
                          () => window.mediPharm.createSnapshot(),
                          (result) =>
                            `Snapshot verified with ${result.recordCount} sample records.`,
                        )
                      }
                    >
                      Create test snapshot <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || !canWrite || !status?.snapshotExists}
                      onClick={() =>
                        void run(
                          () => window.mediPharm.verifyRestore(),
                          (result) =>
                            `Restore verified: ${result.recordCount} sample records opened from a separate copy.`,
                        )
                      }
                    >
                      Verify restored copy <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                  <p className="footnote">
                    Raw snapshots are unencrypted. This is not the pharmacy backup feature.
                  </p>
                </section>
              </div>
              <section className="card device-card">
                <div>
                  <h2>Device checks</h2>
                  <p>Verify native capabilities before building the business workflows.</p>
                </div>
                <div className="device-actions">
                  <button
                    className="secondary"
                    disabled={busy || !canWrite}
                    onClick={() =>
                      void run(
                        () => window.mediPharm.checkKeyStorage(),
                        (result) => result.message,
                      )
                    }
                  >
                    Check protected key storage
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !canWrite}
                    onClick={() =>
                      void run(
                        () => window.mediPharm.chooseFolder(),
                        (result) =>
                          result
                            ? `Folder picker worked: ${result.name}. No files were written there.`
                            : 'Folder selection cancelled.',
                      )
                    }
                  >
                    Open folder picker
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => window.mediPharm.exportDiagnostics(),
                        (result) =>
                          result.saved
                            ? 'Diagnostics saved. The file contains only technical event names and times.'
                            : 'Diagnostics export cancelled.',
                      )
                    }
                  >
                    Save diagnostics
                  </button>
                </div>
              </section>
              <footer>
                <span>Prototype data folder</span>
                <code>{status?.dataDirectory ?? 'Waiting for local storage'}</code>
                <span>
                  {status && `v${status.appVersion} · Electron ${status.electronVersion}`}
                </span>
              </footer>
            </>
          )}
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
