import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;
const version = z.literal(PROTOCOL_VERSION);
export const noInputSchema = z.undefined();
export const saveRecordSchema = z
  .object({
    requestId: z.uuid(),
    note: z.string().trim().min(1).max(160),
  })
  .strict();
export const failureSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum([
      'INVALID_REQUEST',
      'NOT_READY',
      'BUSY',
      'STORAGE_ERROR',
      'OUTCOME_UNKNOWN',
      'AUTH_REQUIRED',
      'AUTH_FAILED',
      'THROTTLED',
      'CONFLICT',
    ]),
    message: z.string().min(1).max(400),
  })
  .strict();
export type FailureCode = z.infer<typeof failureSchema>['code'];
export type Result<T> = { ok: true; data: T } | z.infer<typeof failureSchema>;
export const resultSchema = <T extends z.ZodType>(data: T) =>
  z.union([z.object({ ok: z.literal(true), data }).strict(), failureSchema]);
export const storageStatusSchema = z
  .object({
    recordCount: z.number().int().nonnegative(),
    lastRecord: z
      .object({ note: z.string().max(160), savedAt: z.iso.datetime() })
      .strict()
      .nullable(),
    sqliteVersion: z.string().max(40),
    journalMode: z.enum(['wal']),
    snapshotExists: z.boolean(),
  })
  .strict();
export const desktopStatusSchema = storageStatusSchema.extend({
  appVersion: z.string().max(40),
  electronVersion: z.string().max(40),
  platform: z.string().max(20),
  architecture: z.string().max(20),
  dataDirectory: z.string().max(4096),
});
export const verificationSchema = z
  .object({ recordCount: z.number().int().nonnegative(), checkedAt: z.iso.datetime() })
  .strict();
export const keyProbeSchema = z
  .object({ protected: z.boolean(), message: z.string().max(400) })
  .strict();
export const folderSchema = z
  .object({ name: z.string().max(255) })
  .strict()
  .nullable();
export const exportSchema = z.object({ saved: z.boolean() }).strict();
export const lifecycleStateSchema = z.enum([
  'starting',
  'setupRequired',
  'locked',
  'ready',
  'maintenance',
  'recoveryRequired',
  'stopping',
]);
export const lifecycleSchema = z
  .object({
    version,
    revision: z.number().int().nonnegative(),
    state: lifecycleStateSchema,
    message: z.string().max(400),
    operation: z.enum(['snapshot', 'restoreCheck']).nullable(),
  })
  .strict();
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export type LifecycleState = Lifecycle['state'];
export type SaveRecord = z.infer<typeof saveRecordSchema>;
export type StorageStatus = z.infer<typeof storageStatusSchema>;
export type DesktopStatus = z.infer<typeof desktopStatusSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type KeyProbe = z.infer<typeof keyProbeSchema>;

export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((value) => value.normalize('NFKC').toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9._-]{3,80}$/));
export const passwordSchema = z.string().min(12).max(128);
export const recoveryCodeSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const setupSchema = z
  .object({
    pharmacyName: z.string().trim().min(1).max(120),
    identifier: identifierSchema,
    password: passwordSchema,
    recoveryCode: recoveryCodeSchema,
  })
  .strict();
export const loginSchema = z
  .object({ identifier: identifierSchema, password: z.string().min(1).max(128) })
  .strict();
export const recoverSchema = z
  .object({
    identifier: identifierSchema,
    recoveryCode: recoveryCodeSchema,
    password: passwordSchema,
    newRecoveryCode: recoveryCodeSchema,
  })
  .strict()
  .refine((value) => value.recoveryCode !== value.newRecoveryCode, {
    message: 'Generate a new recovery code.',
  });
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), password: passwordSchema })
  .strict();
export const accountStateSchema = z
  .object({ state: z.enum(['setupRequired', 'locked', 'ready']) })
  .strict();
export const pharmacySchema = z
  .object({ name: z.string().min(1).max(120), version: z.number().int().positive() })
  .strict();
export const updatePharmacySchema = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export const workspaceStatusSchema = z
  .object({
    pharmacy: pharmacySchema,
    identifier: identifierSchema,
    customers: z.number().int().nonnegative(),
    medicines: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    sqliteVersion: z.string().max(40),
    journalMode: z.literal('wal'),
  })
  .strict();
export type Setup = z.infer<typeof setupSchema>;
export type Login = z.infer<typeof loginSchema>;
export type Recover = z.infer<typeof recoverSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
export type UpdatePharmacy = z.infer<typeof updatePharmacySchema>;
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export type AccountState = z.infer<typeof accountStateSchema>;
const envelope = { version, id: z.uuid() };
export const serviceRequestSchema = z.discriminatedUnion('command', [
  z.object({ ...envelope, command: z.literal('accountState') }).strict(),
  z.object({ ...envelope, command: z.literal('setup'), input: setupSchema }).strict(),
  z.object({ ...envelope, command: z.literal('login'), input: loginSchema }).strict(),
  z.object({ ...envelope, command: z.literal('recover'), input: recoverSchema }).strict(),
  z
    .object({ ...envelope, command: z.literal('changePassword'), input: changePasswordSchema })
    .strict(),
  z.object({ ...envelope, command: z.literal('logout') }).strict(),
  z.object({ ...envelope, command: z.literal('status') }).strict(),
  z
    .object({ ...envelope, command: z.literal('updatePharmacy'), input: updatePharmacySchema })
    .strict(),
  z.object({ ...envelope, command: z.literal('shutdown') }).strict(),
]);
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;
export type ServiceCommand = ServiceRequest extends infer R
  ? R extends ServiceRequest
    ? Omit<R, 'id' | 'version'>
    : never
  : never;
export const serviceResultSchemas = {
  accountState: accountStateSchema,
  setup: accountStateSchema,
  login: accountStateSchema,
  recover: accountStateSchema,
  changePassword: accountStateSchema,
  logout: accountStateSchema,
  status: workspaceStatusSchema,
  updatePharmacy: pharmacySchema,
  shutdown: z.null(),
};
export type ServiceData<C extends ServiceCommand['command']> = z.infer<
  (typeof serviceResultSchemas)[C]
>;
export const serviceMessageSchema = z.discriminatedUnion('type', [
  z.object({ version, type: z.literal('ready') }).strict(),
  z.object({ version, type: z.literal('fatal') }).strict(),
  z.object({ version, type: z.literal('result'), id: z.uuid(), result: z.unknown() }).strict(),
]);

export interface DesktopApi {
  status(): Promise<Result<WorkspaceStatus>>;
  setup(input: Setup): Promise<Result<AccountState>>;
  login(input: Login): Promise<Result<AccountState>>;
  recover(input: Recover): Promise<Result<AccountState>>;
  changePassword(input: ChangePassword): Promise<Result<AccountState>>;
  logout(): Promise<Result<AccountState>>;
  updatePharmacy(input: UpdatePharmacy): Promise<Result<z.infer<typeof pharmacySchema>>>;
  lifecycle(): Promise<Result<Lifecycle>>;
  restartStorage(): Promise<Result<Lifecycle>>;
  setDraftDirty(dirty: boolean): Promise<Result<null>>;
  exportDiagnostics(): Promise<Result<{ saved: boolean }>>;
  onLifecycle(listener: (state: Lifecycle) => void): () => void;
}
export const channels = {
  status: 'desktop:status',
  setup: 'desktop:setup',
  login: 'desktop:login',
  recover: 'desktop:recover',
  changePassword: 'desktop:change-password',
  logout: 'desktop:logout',
  updatePharmacy: 'desktop:update-pharmacy',
  lifecycle: 'desktop:lifecycle',
  restartStorage: 'desktop:restart-storage',
  setDraftDirty: 'desktop:set-draft-dirty',
  exportDiagnostics: 'desktop:export-diagnostics',
  lifecycleChanged: 'desktop:lifecycle-changed',
} as const;
