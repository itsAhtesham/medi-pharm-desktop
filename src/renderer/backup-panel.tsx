import React, { useEffect, useState, useRef } from 'react';
import { BackButton } from './back-button';
import type { BackupStatus, RestorePreview } from '../contracts/backup';
import type { Result } from '../contracts/desktop';

export function BackupPanel({
  fresh = false,
  disabled = false,
  onRestored,
  onStatusChange,
  onBusy,
  onBack,
  backDestination = 'settings',
}: {
  onStatusChange?: (status: BackupStatus) => void;
  onBusy?: (busy: boolean) => void;
  onBack?: () => void;
  backDestination?: string;
  fresh?: boolean;
  disabled?: boolean;
  onRestored: (backupCreated: boolean) => void;
}) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(true);
  const [saved, setSaved] = useState(false);
  const [oldPhrase, setOldPhrase] = useState('');
  const [newPhrase, setNewPhrase] = useState('');
  const [repeatPhrase, setRepeatPhrase] = useState('');
  const [rotateMaster, setRotateMaster] = useState(false);
  const [rotationAcknowledged, setRotationAcknowledged] = useState(false);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const blocked = busy || disabled;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest('.main-layout')?.scrollTo({ top: 0 });
  }, [preview]);
  useEffect(() => {
    onBusy?.(busy || Boolean(preview));
    return () => onBusy?.(false);
  }, [busy, preview, onBusy]);
  useEffect(() => {
    if (status && !disabled) onStatusChange?.(status);
  }, [status, disabled, onStatusChange]);
  useEffect(() => {
    if (fresh || disabled) return;
    let active = true;
    void window.mediPharm.backupStatus().then((result) => {
      if (active && result.ok) setStatus(result.data);
    });
    return () => {
      active = false;
    };
  }, [fresh, disabled]);
  async function run<T>(action: () => Promise<Result<T>>, success: (value: T) => void) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (result.ok) success(result.data);
      else setError(result.message);
    } catch {
      setError('The backup operation was interrupted. Check storage before trying again.');
    } finally {
      setBusy(false);
    }
  }
  const cancelPreview = () =>
    void run(
      () => window.mediPharm.restoreCancel(),
      () => {
        setPreview(null);
        setConfirmation('');
      },
    );
  const time = (value: number | null) =>
    value === null ? 'No verified backup yet' : new Date(value).toLocaleString();
  return (
    <section className="card backup-panel">
      {preview ? (
        <BackButton
          destination={fresh ? 'restore setup' : 'backups & restore'}
          disabled={blocked}
          onClick={cancelPreview}
        />
      ) : (
        onBack && <BackButton destination={backDestination} disabled={blocked} onClick={onBack} />
      )}
      <h2 ref={heading} tabIndex={-1}>
        {preview
          ? 'Review restore'
          : fresh
            ? 'Restore an existing pharmacy'
            : 'Encrypted backups & restore'}
      </h2>
      <p className="body-copy" hidden={Boolean(preview)}>
        A backup passphrase is separate from your owner password and recovery code. Keep it
        somewhere private, away from this computer.
      </p>
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
      <div hidden={Boolean(preview)}>
        {!fresh && status && (
          <>
            <dl className="backup-status">
              <div>
                <dt>Last local backup</dt>
                <dd>{time(status.localLast)}</dd>
              </div>
              <div>
                <dt>Last external backup</dt>
                <dd>
                  {time(status.externalLast)}
                  {status.externalPending && ' · Pending'}
                </dd>
              </div>
              <div>
                <dt>Automatic backups</dt>
                <dd>
                  {status.unlocked
                    ? status.osProtected
                      ? 'Key protected by this OS account'
                      : 'Unlocked for this app session'
                    : 'Unlock required'}{' '}
                  · checked daily while signed in
                </dd>
              </div>
            </dl>
            {status.message && <p className="body-copy">{status.message}</p>}
            {!status.unlocked && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setError('');
                  if (!status.configured && passphrase !== confirm) {
                    setError('The backup passphrases do not match.');
                    return;
                  }
                  void run(
                    () =>
                      status.configured
                        ? window.mediPharm.backupUnlock({ passphrase, remember })
                        : window.mediPharm.backupConfigure({ passphrase, remember }),
                    (value) => {
                      setStatus(value);
                      setMessage('Backups unlocked. Create a backup and rehearse a restore.');
                    },
                  ).finally(() => {
                    setPassphrase('');
                    setConfirm('');
                  });
                }}
              >
                <fieldset disabled={blocked}>
                  <label htmlFor="backup-passphrase">
                    {status.configured ? 'Backup passphrase' : 'New backup passphrase'}
                  </label>
                  <input
                    id="backup-passphrase"
                    type="password"
                    autoComplete="off"
                    minLength={15}
                    maxLength={128}
                    required
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                  {!status.configured && (
                    <>
                      <label htmlFor="backup-confirm">Confirm backup passphrase</label>
                      <input
                        id="backup-confirm"
                        type="password"
                        autoComplete="off"
                        minLength={15}
                        maxLength={128}
                        required
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={saved}
                          onChange={(e) => setSaved(e.target.checked)}
                        />
                        I have saved this backup passphrase separately
                      </label>
                    </>
                  )}
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    Remember securely on this computer, if OS protection is available
                  </label>
                  <button className="primary" disabled={!status.configured && !saved} type="submit">
                    {status.configured ? 'Unlock backups' : 'Set up encrypted backups'}
                  </button>
                </fieldset>
              </form>
            )}
            <div className="device-actions">
              <button
                className="secondary"
                disabled={blocked}
                onClick={() =>
                  void run(
                    () => window.mediPharm.openBackupFolder(),
                    () => {},
                  )
                }
              >
                Open local backup folder
              </button>
              <button
                className="primary"
                disabled={blocked || !status.unlocked}
                onClick={() =>
                  void run(
                    () => window.mediPharm.backupCreate(),
                    (value) => {
                      setStatus(value);
                      setMessage(value.message);
                    },
                  )
                }
              >
                Create encrypted backup
              </button>
              <button
                className="secondary"
                disabled={blocked || !status.unlocked}
                onClick={() =>
                  void run(
                    () => window.mediPharm.backupExternal(),
                    (value) => {
                      if (value) {
                        setStatus(value);
                        setMessage(value.message || 'External destination registered.');
                      }
                    },
                  )
                }
              >
                {status.externalName
                  ? `Reselect external folder (${status.externalName})`
                  : 'Choose external backup folder'}
              </button>
            </div>
            {status.unlocked && (
              <details className="key-rotation">
                <summary>Change backup passphrase or encryption key</summary>
                <p className="body-copy">
                  Only future archives use the new passphrase. Older backups still require the
                  passphrase used when they were made. Rotating the encryption key does not
                  re-encrypt existing files.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newPhrase !== repeatPhrase) {
                      setError('The replacement passphrases do not match.');
                      return;
                    }
                    void run(
                      () =>
                        window.mediPharm.backupRotate({
                          currentPassphrase: oldPhrase,
                          passphrase: newPhrase,
                          rotateMasterKey: rotateMaster,
                          remember,
                        }),
                      (value) => {
                        setStatus(value);
                        setMessage(
                          'Backup credentials updated and a new encrypted archive verified. Keep the old passphrase for older archives.',
                        );
                      },
                    ).finally(() => {
                      setOldPhrase('');
                      setNewPhrase('');
                      setRepeatPhrase('');
                      setRotationAcknowledged(false);
                    });
                  }}
                >
                  <fieldset disabled={blocked}>
                    <label htmlFor="old-backup-phrase">Current backup passphrase</label>
                    <input
                      id="old-backup-phrase"
                      type="password"
                      autoComplete="off"
                      minLength={15}
                      maxLength={128}
                      required
                      value={oldPhrase}
                      onChange={(e) => setOldPhrase(e.target.value)}
                    />
                    <label htmlFor="new-backup-phrase">Replacement backup passphrase</label>
                    <input
                      id="new-backup-phrase"
                      type="password"
                      autoComplete="off"
                      minLength={15}
                      maxLength={128}
                      required
                      value={newPhrase}
                      onChange={(e) => setNewPhrase(e.target.value)}
                    />
                    <label htmlFor="repeat-backup-phrase">Confirm replacement passphrase</label>
                    <input
                      id="repeat-backup-phrase"
                      type="password"
                      autoComplete="off"
                      minLength={15}
                      maxLength={128}
                      required
                      value={repeatPhrase}
                      onChange={(e) => setRepeatPhrase(e.target.value)}
                    />
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={rotateMaster}
                        onChange={(e) => setRotateMaster(e.target.checked)}
                      />
                      Also rotate the encryption key for future archives
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      Remember the updated key securely on this computer
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={rotationAcknowledged}
                        onChange={(e) => setRotationAcknowledged(e.target.checked)}
                      />
                      I saved the new passphrase and will keep the old one for older archives
                    </label>
                    <button className="secondary" type="submit" disabled={!rotationAcknowledged}>
                      Update backup credentials
                    </button>
                  </fieldset>
                </form>
              </details>
            )}
            <p className="field-help backup-help">
              Local archives stay on this computer. Use an external drive to protect against losing
              the computer. Keep 14 daily and 8 weekly archives; restore safety copies remain
              pinned.
            </p>
          </>
        )}
        <div className="restore-section">
          <h3>Restore from a .mpbackup file</h3>
          <p className="body-copy">
            Restore replaces the pharmacy; it does not merge records.{' '}
            {fresh
              ? 'You will sign in with the owner account saved in that backup.'
              : 'Unlock backups first so a safety copy of the current pharmacy can be verified.'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => window.mediPharm.restorePreview({ passphrase: restorePassphrase }),
                (value) => {
                  setPreview(value);
                  setConfirmation('');
                },
              ).finally(() => setRestorePassphrase(''));
            }}
          >
            <fieldset disabled={blocked}>
              <label htmlFor="restore-passphrase">Passphrase for the archive</label>
              <input
                id="restore-passphrase"
                type="password"
                autoComplete="off"
                minLength={15}
                maxLength={128}
                required
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
              />
              <button className="secondary" type="submit">
                Choose and verify backup
              </button>
            </fieldset>
          </form>
        </div>
      </div>
      {preview && (
        <div className="restore-preview">
          <h3>Verified: {preview.pharmacyName}</h3>
          <p>
            Captured {time(preview.capturedAt)} · Revision {preview.revision}
          </p>
          <p>
            {preview.customers} customers · {preview.medicines} medicines · {preview.purchases}{' '}
            purchases
          </p>
          {preview.damagedLocal && (
            <p>
              <strong>
                The current installation is damaged. Its original files will be retained, but cannot
                be verified as a safety backup.
              </strong>
            </p>
          )}
          {preview.differentDataset && (
            <p>
              <strong>This backup belongs to a different pharmacy dataset.</strong>
            </p>
          )}
          <p>
            Later local changes and unsaved drafts will be replaced. Preview expires after ten
            minutes.
          </p>
          <label htmlFor="restore-confirm">Type RESTORE to confirm replacement</label>
          <input
            id="restore-confirm"
            autoComplete="off"
            value={confirmation}
            disabled={blocked}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <div className="device-actions">
            <button
              className="primary"
              disabled={blocked || confirmation !== 'RESTORE' || (!fresh && !status?.unlocked)}
              onClick={() =>
                void run(
                  () =>
                    window.mediPharm.restoreConfirm({
                      token: preview.token,
                      confirmation: 'RESTORE',
                      salvage: preview.damagedLocal,
                    }),
                  (value) => {
                    setPreview(null);
                    setMessage(
                      value.backupCreated
                        ? 'Restore completed and a new backup was verified. Sign in to the restored pharmacy.'
                        : 'Restore completed. A new backup could not be made; sign in and check backups.',
                    );
                    onRestored(value.backupCreated);
                  },
                )
              }
            >
              Restore this pharmacy
            </button>
            <button className="secondary" disabled={blocked} onClick={cancelPreview}>
              Cancel restore preview
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
