import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Result, ServiceRequest } from '../contracts/desktop';

type Command = ServiceRequest extends infer R ? R extends ServiceRequest ? Omit<R, 'id'> : never : never;
const unavailable = (): Result<never> => ({ ok: false, code: 'NOT_READY', message: 'Local storage is unavailable. Restart the prototype. If it was initialized before, preserve its files for recovery.' });

export class ServiceClient {
  private child: UtilityProcess;
  private pending = new Map<string, { resolve: (result: Result<unknown>) => void; timer: ReturnType<typeof setTimeout> }>();
  private available = false;
  private exited = false;
  readonly ready: Promise<void>;

  constructor(entry: string, root: string) {
    this.child = utilityProcess.fork(entry, [root], { serviceName: 'MediPharm local storage', stdio: 'pipe' });
    // Drain streams without recording database content or raw exception messages.
    this.child.stdout?.resume();
    this.child.stderr?.resume();
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.child.kill(); reject(new Error('Storage startup timed out.')); }, 15_000);
      const fail = () => { clearTimeout(timer); reject(new Error('Storage could not start.')); };
      this.child.on('message', (message) => {
        if (message?.type === 'ready') { clearTimeout(timer); this.available = true; resolve(); }
        if (message?.type === 'fatal') fail();
        if (typeof message?.id !== 'string') return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        pending.resolve(message.result);
      });
      this.child.on('exit', () => {
        this.available = false;
        this.exited = true;
        fail();
        for (const item of this.pending.values()) {
          clearTimeout(item.timer);
          item.resolve({ ok: false, code: 'OUTCOME_UNKNOWN', message: 'The storage process stopped. A submitted save may have completed. Restart and retry the same submission before entering it again.' });
        }
        this.pending.clear();
      });
    });
  }

  request<T>(command: Command): Promise<Result<T>> {
    if (!this.available || this.pending.size >= 32) return Promise.resolve(unavailable());
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: 'OUTCOME_UNKNOWN', message: 'Storage did not respond in time. A save may have completed; retry the same submission.' });
      }, 30_000);
      this.pending.set(id, { resolve: resolve as (result: Result<unknown>) => void, timer });
      this.child.postMessage({ ...command, id });
    });
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    const finished = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    const timer = setTimeout(() => this.child.kill(), 5_000);
    if (this.available) void this.request({ command: 'shutdown' });
    else this.child.kill();
    await finished;
    clearTimeout(timer);
  }
}
