import { describe, expect, it } from 'vitest';
import { LifecycleController, permits } from '../../src/application/lifecycle';

describe('application lifecycle', () => {
  it('blocks business operations while starting, locked, maintaining, recovering, or stopping', () => {
    for (const state of [
      'starting',
      'setupRequired',
      'locked',
      'maintenance',
      'recoveryRequired',
      'stopping',
    ] as const) {
      for (const operation of ['read', 'write', 'snapshot'] as const)
        expect(permits(state, operation)).toBe(false);
    }
    expect(permits('ready', 'write')).toBe(true);
    expect(permits('recoveryRequired', 'restart')).toBe(true);
    expect(permits('ready', 'restart')).toBe(false);
    expect(permits('stopping', 'diagnostics')).toBe(false);
  });
  it('publishes monotonic revisions and permits explicit recovery without a direct recovery-to-ready shortcut', () => {
    const revisions: number[] = [];
    const state = new LifecycleController((value) => revisions.push(value.revision));
    state.move('ready', 'Ready');
    state.move('maintenance', 'Snapshot', 'snapshot');
    state.move('recoveryRequired', 'Stopped');
    expect(() => state.move('ready', 'Skip startup')).toThrow();
    state.move('starting', 'Restart');
    state.move('ready', 'Ready');
    expect(revisions).toEqual([1, 2, 3, 4, 5]);
    const copy = state.value;
    copy.state = 'stopping';
    expect(state.value.state).toBe('ready');
    expect(() => state.move('maintenance', 'Missing operation')).toThrow();
    state.move('stopping', 'Closing');
    expect(() => state.move('ready', 'Reopen')).toThrow();
  });
});
