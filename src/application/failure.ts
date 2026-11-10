import type { FailureCode } from '../contracts/desktop';
export class ApplicationFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
  }
}
