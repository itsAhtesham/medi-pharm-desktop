import { DashboardService } from '../application/dashboard-service';
import { CsvExporter } from '../application/csv-export';
import { SupplyReport } from '../application/supply-report';
import { BusinessService } from '../application/business-service';
import { BackupManager } from '../backup/manager';
import { PharmacyDatabase } from '../db/pharmacy-database';
import { OwnerService } from '../application/owner-service';
import { ApplicationFailure } from '../application/failure';
import { PROTOCOL_VERSION, serviceRequestSchema } from '../contracts/desktop';

const port = process.parentPort;
const parentPid = process.ppid;
if (!port) throw new Error('This service requires an Electron parent.');
let store: OwnerService;
let backups: BackupManager;
let business: BusinessService;
let queue = Promise.resolve();
let stopping = false;
let queued = 0;

try {
  if (!process.argv[2]) throw new Error('Missing application root.');
  store = new OwnerService(new PharmacyDatabase(process.argv[2], true));
  backups = new BackupManager(store);
  business = new BusinessService(store);
  port.postMessage({ version: PROTOCOL_VERSION, type: 'ready' });
} catch {
  port.postMessage({ version: PROTOCOL_VERSION, type: 'fatal' });
  process.exit(1);
}

port.on('message', (event) => {
  const parsed = serviceRequestSchema.safeParse(event.data);
  if (!parsed.success || stopping) return;
  const request = parsed.data;
  if (queued >= 32) {
    port.postMessage({
      version: PROTOCOL_VERSION,
      type: 'result',
      id: request.id,
      result: {
        ok: false,
        code: 'BUSY',
        message: 'Storage is busy. Try again after the current operation.',
      },
    });
    return;
  }
  queued += 1;
  if (request.command === 'shutdown') stopping = true;
  queue = queue.then(async () => {
    try {
      if (backups.broken && request.command !== 'shutdown')
        throw new ApplicationFailure(
          'RECOVERY_REQUIRED',
          'A restore needs recovery. Restart storage to resolve the replacement journal.',
        );
      let data: unknown;
      switch (request.command) {
        case 'exportCsv':
          data = new CsvExporter(store).export(request.input.selection, request.input.filename);
          break;
        case 'customerSupplies':
          data = new SupplyReport(store).query(request.input);
          break;
        case 'dashboard':
          data = new DashboardService(store).read(request.input);
          break;
        case 'businessQuery':
          data = business.query(request.input);
          break;
        case 'businessSave':
          data = business.save(request.input);
          break;
        case 'purchasePreview':
          data = business.preview(request.input);
          break;
        case 'status':
          data = store.status();
          break;
        case 'accountState':
          data = store.accountState();
          break;
        case 'setup':
          data = await store.setup(request.input);
          break;
        case 'login':
          data = await store.login(request.input);
          break;
        case 'recover':
          data = await store.recover(request.input);
          break;
        case 'changePassword':
          data = await store.changePassword(request.input);
          break;
        case 'logout':
          data = store.logout();
          break;
        case 'updatePharmacy':
          data = store.updatePharmacy(request.input);
          break;
        case 'backupStatus':
          data = backups.status();
          break;
        case 'backupRotate':
          data = await backups.rotate(request.input);
          break;
        case 'backupConfigure':
          data = await backups.configure(request.input.passphrase);
          break;
        case 'backupUnlock':
          data = await backups.unlock(request.input.passphrase);
          break;
        case 'backupUnlockDevice':
          data = backups.unlockDevice(request.input.key);
          break;
        case 'backupCreate':
          data = await backups.create();
          break;
        case 'backupTick':
          data = await backups.tick();
          break;
        case 'backupExternal':
          data = backups.configureExternal(request.input.directory);
          break;
        case 'restorePreview':
          data = await backups.preview(request.input.filename, request.input.passphrase);
          break;
        case 'restoreConfirm':
          data = await backups.restore(request.input.token, request.input.salvage);
          break;
        case 'restoreCancel':
          data = backups.cancelPreview();
          break;
        case 'shutdown':
          backups.close();
          store.close();
          data = null;
          break;
      }
      port.postMessage({
        version: PROTOCOL_VERSION,
        type: 'result',
        id: request.id,
        result: { ok: true, data },
      });
      if (request.command === 'shutdown') process.exit(0);
    } catch (error) {
      port.postMessage({
        version: PROTOCOL_VERSION,
        type: 'result',
        id: request.id,
        result: {
          ok: false,
          code: backups.broken
            ? 'RECOVERY_REQUIRED'
            : error instanceof ApplicationFailure
              ? error.code
              : 'STORAGE_ERROR',
          message: backups.broken
            ? 'Restore was interrupted. Restart storage to recover the verified generation.'
            : error instanceof ApplicationFailure
              ? error.message
              : 'The local operation failed. Preserve the data files and check available disk space.',
        },
      });
    } finally {
      queued -= 1;
    }
  });
});

// Parent death must not leave a database-owning process running.
setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    if (!stopping) {
      stopping = true;
      void queue.finally(() => {
        backups.close();
        store.close();
        process.exit(0);
      });
    }
  }
}, 1000).unref();
process.on('SIGTERM', () => {
  stopping = true;
  void queue.finally(() => {
    backups.close();
    store.close();
    process.exit(0);
  });
});
