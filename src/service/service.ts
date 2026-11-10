import { PrototypeStore } from '../db/prototype-store';
import { serviceRequestSchema } from '../contracts/desktop';

const port = process.parentPort;
const parentPid = process.ppid;
if (!port) throw new Error('This service requires an Electron parent.');
let store: PrototypeStore;
let queue = Promise.resolve();
let stopping = false;

try {
  if (!process.argv[2]) throw new Error('Missing prototype root.');
  store = new PrototypeStore(process.argv[2]);
  port.postMessage({ type: 'ready' });
} catch {
  port.postMessage({ type: 'fatal' });
  process.exit(1);
}

port.on('message', (event) => {
  const parsed = serviceRequestSchema.safeParse(event.data);
  if (!parsed.success || stopping) return;
  const request = parsed.data;
  if (request.command === 'shutdown') stopping = true;
  queue = queue.then(async () => {
    try {
      let data: unknown;
      switch (request.command) {
        case 'status': data = store.status(); break;
        case 'save': data = store.save(request.input); break;
        case 'snapshot': data = await store.snapshot(); break;
        case 'verifyRestore': data = store.verifyRestore(); break;
        case 'shutdown': store.close(); data = null; break;
      }
      port.postMessage({ id: request.id, result: { ok: true, data } });
      if (request.command === 'shutdown') process.exit(0);
    } catch {
      port.postMessage({ id: request.id, result: { ok: false, code: 'STORAGE_ERROR', message: 'The storage operation failed. Existing records have been preserved. Check the prototype files and available disk space.' } });
    }
  });
});

// Parent death must not leave a database-owning process running.
setInterval(() => {
  try { process.kill(parentPid, 0); }
  catch { if (!stopping) { stopping = true; void queue.finally(() => { store.close(); process.exit(0); }); } }
}, 1000).unref();
process.on('SIGTERM', () => { stopping = true; void queue.finally(() => { store.close(); process.exit(0); }); });
