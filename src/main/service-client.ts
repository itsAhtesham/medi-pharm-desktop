import { utilityProcess, type UtilityProcess } from 'electron';
import { RequestBroker } from '../application/request-broker';
import {
  serviceMessageSchema,
  type Result,
  type ServiceCommand,
  type ServiceData,
} from '../contracts/desktop';

export class ServiceClient {
  private readonly child: UtilityProcess;
  private readonly broker: RequestBroker;
  private available = false;
  private exited = false;
  private stopping = false;
  private failed = false;
  readonly ready: Promise<void>;

  constructor(
    entry: string,
    root: string,
    onFailure: (reason: 'failed' | 'timeout' | 'protocol' | 'transport') => void,
  ) {
    this.child = utilityProcess.fork(entry, [root], {
      serviceName: 'MediPharm local storage',
      stdio: 'pipe',
    });
    this.child.stdout?.resume();
    this.child.stderr?.resume();
    const fail = (reason: 'failed' | 'timeout' | 'protocol' | 'transport') => {
      this.available = false;
      this.broker.close();
      if (!this.failed && !this.stopping) {
        this.failed = true;
        onFailure(reason);
      }
    };
    this.broker = new RequestBroker(
      (message) => this.child.postMessage(message),
      (reason) => {
        fail(reason);
        this.child.kill();
      },
    );
    this.ready = new Promise((resolve, reject) => {
      let started = false;
      const timer = setTimeout(() => {
        fail('timeout');
        this.child.kill();
        reject(new Error('Storage startup timed out.'));
      }, 15_000);
      const rejectStartup = () => {
        clearTimeout(timer);
        reject(new Error('Storage could not start.'));
      };
      this.child.on('message', (raw: unknown) => {
        const message = serviceMessageSchema.safeParse(raw);
        if (!message.success) {
          fail('protocol');
          rejectStartup();
          this.child.kill();
          return;
        }
        if (!started) {
          if (message.data.type === 'ready') {
            started = true;
            clearTimeout(timer);
            this.available = true;
            resolve();
            return;
          }
          fail('failed');
          rejectStartup();
          this.child.kill();
          return;
        }
        this.broker.receive(message.data);
      });
      this.child.on('exit', () => {
        this.exited = true;
        fail('failed');
        rejectStartup();
      });
    });
  }

  request<C extends ServiceCommand>(command: C): Promise<Result<ServiceData<C['command']>>> {
    if (!this.available || this.stopping)
      return Promise.resolve({
        ok: false,
        code: 'NOT_READY',
        message: 'Local storage is unavailable. Restart storage to continue.',
      });
    return this.broker.request(command);
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    this.stopping = true;
    await new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => this.child.kill(), 5_000);
      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error('Storage did not exit.'));
      }, 10_000);
      const done = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(force);
        clearTimeout(deadline);
        this.child.off('exit', done);
      };
      this.child.once('exit', done);
      if (this.available) void this.broker.request({ command: 'shutdown' });
      else this.child.kill();
    });
  }
}
