import { dashboardSchema, type ValuePeriod } from '../contracts/dashboard';
import {
  csvResultSchema,
  supplyResultSchema,
  type CsvInput,
  type SupplyQuery,
} from '../contracts/reports';
import {
  queryResultSchema,
  mutationResultSchema,
  previewSchema,
  type BusinessQuery,
  type BusinessMutation,
  type PurchaseDraft,
} from '../contracts/business';
import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  backupStatusSchema,
  restorePreviewSchema,
  restoreResultSchema,
  type BackupAccess,
  type BackupRotation,
  type RestoreInput,
  type RestoreConfirm,
} from '../contracts/backup';
import {
  PROTOCOL_VERSION,
  channels,
  workspaceStatusSchema,
  accountStateSchema,
  pharmacySchema,
  exportSchema,
  lifecycleSchema,
  resultSchema,
  type DesktopApi,
  type Lifecycle,
  type Result,
  type Setup,
  type Login,
  type Recover,
  type ChangePassword,
  type UpdatePharmacy,
} from '../contracts/desktop';

async function invoke<T extends z.ZodType>(
  channel: string,
  schema: T,
  input?: unknown,
): Promise<Result<z.infer<T>>> {
  try {
    const raw: unknown = await ipcRenderer.invoke(channel, { version: PROTOCOL_VERSION, input });
    const parsed = resultSchema(schema).safeParse(raw);
    if (parsed.success) return parsed.data as Result<z.infer<T>>;
  } catch {
    /* Transport errors must not expose Electron internals. */
  }
  return {
    ok: false,
    code: 'OUTCOME_UNKNOWN',
    message:
      channel === channels.exportCsv
        ? 'Export confirmation was interrupted. Check the selected CSV file before exporting again.'
        : channel === channels.backupConfigure || channel === channels.backupRotate
          ? 'Backup credentials may have changed. Unlock using the new backup passphrase and create a new archive.'
          : channel === channels.restoreConfirm
            ? 'Restore may have completed. Restart storage, sign in and check the restored pharmacy.'
            : channel === channels.setup ||
                channel === channels.recover ||
                channel === channels.changePassword
              ? 'The account change may have completed. Restart storage and try signing in with the new password. Keep the recovery code you saved.'
              : 'The desktop connection was interrupted. A save may have completed. Keep this submission and retry after storage recovers.',
  };
}
const api: DesktopApi = Object.freeze({
  dashboard: (period: ValuePeriod = 'daily') => invoke(channels.dashboard, dashboardSchema, period),
  exportCsv: (input: CsvInput) => invoke(channels.exportCsv, csvResultSchema, input),
  customerSupplies: (input: SupplyQuery) =>
    invoke(channels.customerSupplies, supplyResultSchema, input),
  businessQuery: (input: BusinessQuery) => invoke(channels.businessQuery, queryResultSchema, input),
  businessSave: (input: BusinessMutation) =>
    invoke(channels.businessSave, mutationResultSchema, input),
  purchasePreview: (input: PurchaseDraft) => invoke(channels.purchasePreview, previewSchema, input),
  backupRotate: (input: BackupRotation) => invoke(channels.backupRotate, backupStatusSchema, input),
  openBackupFolder: () => invoke(channels.openBackupFolder, z.null()),
  backupStatus: () => invoke(channels.backupStatus, backupStatusSchema),
  backupConfigure: (input: BackupAccess) =>
    invoke(channels.backupConfigure, backupStatusSchema, input),
  backupUnlock: (input: BackupAccess) => invoke(channels.backupUnlock, backupStatusSchema, input),
  backupCreate: () => invoke(channels.backupCreate, backupStatusSchema),
  backupExternal: () => invoke(channels.backupExternal, backupStatusSchema.nullable()),
  restorePreview: (input: RestoreInput) =>
    invoke(channels.restorePreview, restorePreviewSchema.nullable(), input),
  restoreConfirm: (input: RestoreConfirm) =>
    invoke(channels.restoreConfirm, restoreResultSchema, input),
  restoreCancel: () => invoke(channels.restoreCancel, z.null()),
  status: () => invoke(channels.status, workspaceStatusSchema),
  setup: (input: Setup) => invoke(channels.setup, accountStateSchema, input),
  login: (input: Login) => invoke(channels.login, accountStateSchema, input),
  recover: (input: Recover) => invoke(channels.recover, accountStateSchema, input),
  changePassword: (input: ChangePassword) =>
    invoke(channels.changePassword, accountStateSchema, input),
  logout: () => invoke(channels.logout, accountStateSchema),
  updatePharmacy: (input: UpdatePharmacy) => invoke(channels.updatePharmacy, pharmacySchema, input),
  lifecycle: () => invoke(channels.lifecycle, lifecycleSchema),
  restartStorage: () => invoke(channels.restartStorage, lifecycleSchema),
  setDraftDirty: (dirty: boolean) => invoke(channels.setDraftDirty, z.null(), dirty),
  exportDiagnostics: () => invoke(channels.exportDiagnostics, exportSchema),
  onLifecycle: (listener: (state: Lifecycle) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      const parsed = lifecycleSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(channels.lifecycleChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.lifecycleChanged, handler);
    };
  },
});
contextBridge.exposeInMainWorld('mediPharm', api);
