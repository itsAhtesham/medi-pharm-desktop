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
    code: z.enum(['INVALID_REQUEST', 'NOT_READY', 'BUSY', 'STORAGE_ERROR', 'OUTCOME_UNKNOWN']),
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

const envelope = { version, id: z.uuid() };
export const serviceRequestSchema = z.discriminatedUnion('command', [
  z.object({ ...envelope, command: z.literal('status') }).strict(),
  z.object({ ...envelope, command: z.literal('save'), input: saveRecordSchema }).strict(),
  z.object({ ...envelope, command: z.literal('snapshot') }).strict(),
  z.object({ ...envelope, command: z.literal('verifyRestore') }).strict(),
  z.object({ ...envelope, command: z.literal('shutdown') }).strict(),
]);
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;
export type ServiceCommand = ServiceRequest extends infer R
  ? R extends ServiceRequest
    ? Omit<R, 'id' | 'version'>
    : never
  : never;
export const serviceResultSchemas = {
  status: storageStatusSchema,
  save: storageStatusSchema,
  snapshot: verificationSchema,
  verifyRestore: verificationSchema,
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
  status(): Promise<Result<DesktopStatus>>;
  saveRecord(input: SaveRecord): Promise<Result<StorageStatus>>;
  createSnapshot(): Promise<Result<Verification>>;
  verifyRestore(): Promise<Result<Verification>>;
  checkKeyStorage(): Promise<Result<KeyProbe>>;
  chooseFolder(): Promise<Result<{ name: string } | null>>;
  lifecycle(): Promise<Result<Lifecycle>>;
  restartStorage(): Promise<Result<Lifecycle>>;
  setDraftDirty(dirty: boolean): Promise<Result<null>>;
  exportDiagnostics(): Promise<Result<{ saved: boolean }>>;
  onLifecycle(listener: (state: Lifecycle) => void): () => void;
}
export const channels = {
  status: 'desktop:status',
  saveRecord: 'desktop:save-record',
  createSnapshot: 'desktop:create-snapshot',
  verifyRestore: 'desktop:verify-restore',
  checkKeyStorage: 'desktop:check-key-storage',
  chooseFolder: 'desktop:choose-folder',
  lifecycle: 'desktop:lifecycle',
  restartStorage: 'desktop:restart-storage',
  setDraftDirty: 'desktop:set-draft-dirty',
  exportDiagnostics: 'desktop:export-diagnostics',
  lifecycleChanged: 'desktop:lifecycle-changed',
} as const;
