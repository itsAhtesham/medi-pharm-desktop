import { randomUUID } from 'node:crypto';
import { PharmacyDatabase, type OwnerRow } from '../db/pharmacy-database';
import { hashSecret, verifySecret } from './credentials';
import { ApplicationFailure } from './failure';
import { mutate } from './mutations';
import {
  setupSchema,
  loginSchema,
  recoverSchema,
  changePasswordSchema,
  updatePharmacySchema,
  pharmacySchema,
  type AccountState,
  type Setup,
  type Login,
  type Recover,
  type ChangePassword,
  type UpdatePharmacy,
  type WorkspaceStatus,
} from '../contracts/desktop';

const sessionMs = 8 * 60 * 60 * 1000;
type Session = { ownerId: string; credentialVersion: number; expires: number; lastSeen: number };
export class OwnerService {
  private session?: Session;
  constructor(
    public store: PharmacyDatabase,
    private readonly now = Date.now,
  ) {}
  accountState(): AccountState {
    if (this.store.recoveryRequired) return { state: 'recoveryRequired' };
    if (!this.store.initialized) return { state: 'setupRequired' };
    return { state: this.currentOwner() ? 'ready' : 'locked' };
  }
  async setup(raw: Setup): Promise<AccountState> {
    const input = setupSchema.parse(raw);
    if (this.store.recoveryRequired)
      throw new ApplicationFailure(
        'RECOVERY_REQUIRED',
        'Preserve the damaged installation and recover it from a verified backup.',
      );
    if (this.store.initialized)
      throw new ApplicationFailure(
        'CONFLICT',
        'This pharmacy is already set up. Sign in with the owner account.',
      );
    const passwordHash = await hashSecret(input.password);
    const recoveryHash = await hashSecret(input.recoveryCode);
    this.store.initialize(
      { name: input.pharmacyName, identifier: input.identifier, passwordHash, recoveryHash },
      this.now(),
    );
    // Setup does not create a session. A lost response is resolved by signing in.
    return this.accountState();
  }
  private attempt(): OwnerRow {
    if (!this.store.initialized)
      throw new ApplicationFailure('NOT_READY', 'Set up the pharmacy first.');
    const now = this.now();
    const state = this.store.db.prepare('SELECT * FROM auth_attempts WHERE id=1').get() as {
      attempts: number;
      blocked_until: number;
      last_at: number;
    };
    if (now < state.last_at)
      throw new ApplicationFailure('THROTTLED', 'Check the computer clock before signing in.');
    if (now < state.blocked_until)
      throw new ApplicationFailure(
        'THROTTLED',
        'Too many unsuccessful attempts. Wait before trying again.',
      );
    const attempts = now - state.last_at > 15 * 60 * 1000 ? 1 : state.attempts + 1;
    const delay = attempts < 5 ? 0 : Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts - 5, 5));
    // Persist before the expensive check, so killing the service cannot reset throttling.
    this.store.db
      .prepare('UPDATE auth_attempts SET attempts=?, blocked_until=?, last_at=? WHERE id=1')
      .run(attempts, now + delay, now);
    return this.store.owner();
  }
  private resetAttempts(): void {
    this.store.db
      .prepare('UPDATE auth_attempts SET attempts=0,blocked_until=0,last_at=? WHERE id=1')
      .run(this.now());
  }
  private authFailed(): never {
    throw new ApplicationFailure('AUTH_FAILED', 'The owner details could not be verified.');
  }
  async login(raw: Login): Promise<AccountState> {
    const input = loginSchema.parse(raw);
    const owner = this.attempt();
    const matches = await verifySecret(input.password, owner.password_hash);
    if (!matches || input.identifier !== owner.identifier || owner.active !== 1) this.authFailed();
    this.resetAttempts();
    const now = this.now();
    this.session = {
      ownerId: owner.id,
      credentialVersion: owner.credential_version,
      expires: now + sessionMs,
      lastSeen: now,
    };
    return this.accountState();
  }
  logout(): AccountState {
    this.session = undefined;
    return this.accountState();
  }
  async recover(raw: Recover): Promise<AccountState> {
    const input = recoverSchema.parse(raw);
    const owner = this.attempt();
    const matches = await verifySecret(input.recoveryCode, owner.recovery_hash);
    if (!matches || input.identifier !== owner.identifier || owner.active !== 1) this.authFailed();
    const password = await hashSecret(input.password);
    const recovery = await hashSecret(input.newRecoveryCode);
    this.store.db
      .transaction(() => {
        this.store.db
          .prepare(
            'UPDATE users SET password_hash=?,recovery_hash=?,credential_version=credential_version+1 WHERE id=?',
          )
          .run(password, recovery, owner.id);
        this.resetAttempts();
        this.audit(owner, 'owner.recovered', 'owner', owner.id, {}, {});
        this.bumpRevision();
      })
      .immediate();
    return this.logout();
  }
  async changePassword(raw: ChangePassword): Promise<AccountState> {
    const input = changePasswordSchema.parse(raw);
    const owner = this.requireOwner();
    this.attempt();
    if (!(await verifySecret(input.currentPassword, owner.password_hash))) this.authFailed();
    const password = await hashSecret(input.password);
    // KDF awaits occur outside the synchronous transaction; recheck session afterwards.
    this.requireOwner();
    this.store.db
      .transaction(() => {
        this.store.db
          .prepare(
            'UPDATE users SET password_hash=?,credential_version=credential_version+1 WHERE id=?',
          )
          .run(password, owner.id);
        this.resetAttempts();
        this.audit(owner, 'owner.passwordChanged', 'owner', owner.id, {}, {});
        this.bumpRevision();
      })
      .immediate();
    return this.logout();
  }
  private currentOwner(): OwnerRow | undefined {
    if (!this.session || !this.store.initialized) return;
    const now = this.now();
    const owner = this.store.owner();
    if (
      now >= this.session.expires ||
      now < this.session.lastSeen ||
      owner.id !== this.session.ownerId ||
      owner.credential_version !== this.session.credentialVersion ||
      owner.active !== 1
    ) {
      this.session = undefined;
      return;
    }
    this.session.lastSeen = now;
    return owner;
  }
  requireOwner(): OwnerRow {
    const owner = this.currentOwner();
    if (!owner)
      throw new ApplicationFailure(
        'AUTH_REQUIRED',
        'Sign in to continue. Your unsaved draft is kept in this window.',
      );
    return owner;
  }
  status(): WorkspaceStatus {
    const owner = this.requireOwner();
    const db = this.store.db;
    const count = (table: 'customers' | 'medicines' | 'purchases') =>
      (
        db
          .prepare(`SELECT count(*) AS count FROM ${table} WHERE pharmacy_id=?`)
          .get(owner.pharmacy_id) as { count: number }
      ).count;
    return {
      pharmacy: pharmacySchema.parse(
        db.prepare('SELECT name,version FROM pharmacies WHERE id=?').get(owner.pharmacy_id),
      ),
      identifier: owner.identifier,
      customers: count('customers'),
      medicines: count('medicines'),
      purchases: count('purchases'),
      revision: (
        db.prepare('SELECT revision FROM app_meta WHERE id=1').get() as { revision: number }
      ).revision,
      sqliteVersion: db.prepare('SELECT sqlite_version()').pluck().get() as string,
      journalMode: 'wal',
    };
  }
  updatePharmacy(raw: UpdatePharmacy): { name: string; version: number } {
    const input = updatePharmacySchema.parse(raw);
    return mutate(
      this.store.db,
      () => this.requireOwner(),
      {
        requestId: input.requestId,
        command: 'pharmacy.update',
        payload: { expectedVersion: input.expectedVersion, name: input.name },
        result: pharmacySchema,
        apply: (owner) => {
          const before = pharmacySchema.parse(
            this.store.db
              .prepare('SELECT name,version FROM pharmacies WHERE id=?')
              .get(owner.pharmacy_id),
          );
          if (before.version !== input.expectedVersion)
            throw new ApplicationFailure(
              'CONFLICT',
              'Pharmacy details changed. Reload the saved details and review your draft.',
            );
          const value = { name: input.name, version: before.version + 1 };
          this.store.db
            .prepare('UPDATE pharmacies SET name=?,version=?,updated_at=? WHERE id=?')
            .run(value.name, value.version, this.now(), owner.pharmacy_id);
          return {
            value,
            entityType: 'pharmacy',
            entityId: owner.pharmacy_id,
            before,
            after: value,
          };
        },
      },
      this.now,
    );
  }
  private audit(
    owner: OwnerRow,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): void {
    this.store.db
      .prepare(
        'INSERT INTO audit_events(id,pharmacy_id,actor_id,entity_type,entity_id,action,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        owner.pharmacy_id,
        owner.id,
        entityType,
        entityId,
        action,
        JSON.stringify({ version: 1, value: before }),
        JSON.stringify({ version: 1, value: after }),
        this.now(),
      );
  }
  private bumpRevision(): void {
    this.store.db.prepare('UPDATE app_meta SET revision=revision+1 WHERE id=1').run();
  }
  close(): void {
    this.session = undefined;
    this.store.close();
  }
}
