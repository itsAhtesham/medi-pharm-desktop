import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  resultSchema,
  serviceMessageSchema,
  serviceRequestSchema,
  serviceResultSchemas,
  type Result,
  type ServiceCommand,
  type ServiceData,
} from '../contracts/desktop';

type Pending = {
  command: ServiceCommand['command'];
  resolve: (result: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Correlates transport messages without depending on Electron or a database. */
export class RequestBroker {
  private pending = new Map<string, Pending>();
  private closed = false;
  constructor(
    private readonly send: (message: unknown) => void,
    private readonly fault: (reason: 'timeout' | 'protocol' | 'transport') => void,
    private readonly timeoutMs = 30_000,
    private readonly limit = 32,
  ) {}

  request<C extends ServiceCommand>(command: C): Promise<Result<ServiceData<C['command']>>> {
    if (this.closed)
      return Promise.resolve({
        ok: false,
        code: 'NOT_READY',
        message: 'Local storage is unavailable. Restart storage to continue.',
      });
    if (this.pending.size >= this.limit)
      return Promise.resolve({
        ok: false,
        code: 'BUSY',
        message: 'Local storage is busy. Wait for the current operation to finish.',
      });
    const id = randomUUID();
    const parsed = serviceRequestSchema.safeParse({ ...command, id, version: PROTOCOL_VERSION });
    if (!parsed.success)
      return Promise.resolve({
        ok: false,
        code: 'INVALID_REQUEST',
        message: 'The storage request is invalid.',
      });
    return new Promise((resolve) => {
      const longOperation = [
        'exportCsv',
        'backupCreate',
        'backupTick',
        'restorePreview',
        'restoreConfirm',
      ].includes(command.command);
      const timer = setTimeout(
        () => this.fail('timeout'),
        longOperation ? Math.max(this.timeoutMs, 120_000) : this.timeoutMs,
      );
      this.pending.set(id, {
        command: command.command,
        resolve: resolve as Pending['resolve'],
        timer,
      });
      try {
        this.send(parsed.data);
      } catch {
        this.fail('transport');
      }
    });
  }

  receive(message: unknown): void {
    if (this.closed) return;
    const parsed = serviceMessageSchema.safeParse(message);
    if (!parsed.success || parsed.data.type !== 'result') {
      this.fail('protocol');
      return;
    }
    const pending = this.pending.get(parsed.data.id);
    if (!pending) {
      this.fail('protocol');
      return;
    }
    const result = resultSchema(serviceResultSchemas[pending.command]).safeParse(
      parsed.data.result,
    );
    if (!result.success) {
      this.fail('protocol');
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(parsed.data.id);
    pending.resolve(result.data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      const uncertain = [
        'setup',
        'recover',
        'changePassword',
        'updatePharmacy',
        'businessSave',
        'exportCsv',
        'backupCreate',
        'backupConfigure',
        'backupRotate',
        'restoreConfirm',
      ].includes(item.command);
      item.resolve({
        ok: false,
        code: uncertain ? 'OUTCOME_UNKNOWN' : 'NOT_READY',
        message:
          item.command === 'exportCsv'
            ? 'Export confirmation was interrupted. Check the selected CSV file before exporting again.'
            : ['backupConfigure', 'backupRotate'].includes(item.command)
              ? 'Backup credentials may have changed. Unlock using the new backup passphrase and create a new archive.'
              : item.command === 'restoreConfirm'
                ? 'Restore may have completed. Restart storage to recover the journal, then sign in and check the restored pharmacy.'
                : ['setup', 'recover', 'changePassword'].includes(item.command)
                  ? 'The account change may have completed. Restart storage and try signing in with the new password. Keep the recovery code you saved.'
                  : uncertain
                    ? 'Storage stopped before confirming the result. Restart storage, then retry the same submission; it may already have completed.'
                    : 'Local storage stopped. Restart storage to continue.',
      });
    }
    this.pending.clear();
  }
  private fail(reason: 'timeout' | 'protocol' | 'transport'): void {
    this.close();
    this.fault(reason);
  }
}
