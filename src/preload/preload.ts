import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  PROTOCOL_VERSION,
  channels,
  desktopStatusSchema,
  exportSchema,
  folderSchema,
  keyProbeSchema,
  lifecycleSchema,
  resultSchema,
  storageStatusSchema,
  verificationSchema,
  type DesktopApi,
  type Lifecycle,
  type Result,
  type SaveRecord,
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
      'The desktop connection was interrupted. A save may have completed. Keep this submission and retry after storage recovers.',
  };
}
const api: DesktopApi = Object.freeze({
  status: () => invoke(channels.status, desktopStatusSchema),
  saveRecord: (input: SaveRecord) => invoke(channels.saveRecord, storageStatusSchema, input),
  createSnapshot: () => invoke(channels.createSnapshot, verificationSchema),
  verifyRestore: () => invoke(channels.verifyRestore, verificationSchema),
  checkKeyStorage: () => invoke(channels.checkKeyStorage, keyProbeSchema),
  chooseFolder: () => invoke(channels.chooseFolder, folderSchema),
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
