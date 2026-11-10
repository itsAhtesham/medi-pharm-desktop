import { PROTOCOL_VERSION, type Lifecycle, type LifecycleState } from '../contracts/desktop';

const transitions: Record<LifecycleState, readonly LifecycleState[]> = {
  starting: ['setupRequired', 'locked', 'ready', 'recoveryRequired', 'stopping'],
  setupRequired: ['locked', 'ready', 'maintenance', 'recoveryRequired', 'stopping'],
  locked: ['ready', 'maintenance', 'recoveryRequired', 'stopping'],
  ready: ['locked', 'maintenance', 'recoveryRequired', 'stopping'],
  maintenance: ['ready', 'locked', 'recoveryRequired', 'stopping'],
  recoveryRequired: ['starting', 'stopping'],
  stopping: [],
};
export type Operation = 'read' | 'write' | 'snapshot' | 'restart' | 'diagnostics';
export function permits(state: LifecycleState, operation: Operation): boolean {
  if (operation === 'diagnostics') return state !== 'stopping';
  if (operation === 'restart') return state === 'recoveryRequired';
  return state === 'ready';
}

export class LifecycleController {
  private current: Lifecycle = {
    version: PROTOCOL_VERSION,
    revision: 0,
    state: 'starting',
    message: 'Starting local storage…',
    operation: null,
  };
  constructor(private readonly changed: (value: Lifecycle) => void = () => {}) {}
  get value(): Lifecycle {
    return { ...this.current };
  }
  move(state: LifecycleState, message: string, operation: Lifecycle['operation'] = null): void {
    if (!transitions[this.current.state].includes(state))
      throw new Error(`Invalid lifecycle transition: ${this.current.state} -> ${state}`);
    if ((state === 'maintenance') !== (operation !== null))
      throw new Error('Maintenance requires an operation.');
    this.current = {
      version: PROTOCOL_VERSION,
      revision: this.current.revision + 1,
      state,
      message,
      operation,
    };
    this.changed(this.value);
  }
}
