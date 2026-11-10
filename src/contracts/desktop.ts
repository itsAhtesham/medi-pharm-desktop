import { z } from 'zod';

export const saveRecordSchema = z.object({
  requestId: z.uuid(),
  note: z.string().trim().min(1).max(160),
}).strict();

export const serviceRequestSchema = z.discriminatedUnion('command', [
  z.object({ id: z.uuid(), command: z.literal('status') }).strict(),
  z.object({ id: z.uuid(), command: z.literal('save'), input: saveRecordSchema }).strict(),
  z.object({ id: z.uuid(), command: z.literal('snapshot') }).strict(),
  z.object({ id: z.uuid(), command: z.literal('verifyRestore') }).strict(),
  z.object({ id: z.uuid(), command: z.literal('shutdown') }).strict(),
]);

export type ServiceRequest = z.infer<typeof serviceRequestSchema>;
export type SaveRecord = z.infer<typeof saveRecordSchema>;
export type FailureCode = 'INVALID_REQUEST' | 'NOT_READY' | 'STORAGE_ERROR' | 'OUTCOME_UNKNOWN';
export type Result<T> = { ok: true; data: T } | { ok: false; code: FailureCode; message: string };
export type StorageStatus = {
  recordCount: number;
  lastRecord: { note: string; savedAt: string } | null;
  sqliteVersion: string;
  journalMode: string;
  snapshotExists: boolean;
};
export type DesktopStatus = StorageStatus & {
  appVersion: string;
  electronVersion: string;
  platform: string;
  architecture: string;
  dataDirectory: string;
};
export type Verification = { recordCount: number; checkedAt: string };
export type KeyProbe = { protected: boolean; message: string };

export interface DesktopApi {
  status(): Promise<Result<DesktopStatus>>;
  saveRecord(input: SaveRecord): Promise<Result<StorageStatus>>;
  createSnapshot(): Promise<Result<Verification>>;
  verifyRestore(): Promise<Result<Verification>>;
  checkKeyStorage(): Promise<Result<KeyProbe>>;
  chooseFolder(): Promise<Result<{ name: string } | null>>;
}

export const channels = {
  status: 'prototype:status',
  saveRecord: 'prototype:save-record',
  createSnapshot: 'prototype:create-snapshot',
  verifyRestore: 'prototype:verify-restore',
  checkKeyStorage: 'prototype:check-key-storage',
  chooseFolder: 'prototype:choose-folder',
} as const;
