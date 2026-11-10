import { z } from 'zod';
export const backupPassphraseSchema = z.string().min(15).max(128);
export const backupAccessSchema = z
  .object({ passphrase: backupPassphraseSchema, remember: z.boolean() })
  .strict();
export const backupRotationSchema = z
  .object({
    currentPassphrase: backupPassphraseSchema,
    passphrase: backupPassphraseSchema,
    rotateMasterKey: z.boolean(),
    remember: z.boolean(),
  })
  .strict();
export type BackupRotation = z.infer<typeof backupRotationSchema>;
export const restoreInputSchema = z.object({ passphrase: backupPassphraseSchema }).strict();
export const restoreConfirmSchema = z
  .object({
    token: z.uuid(),
    confirmation: z.literal('RESTORE'),
    salvage: z.boolean().default(false),
  })
  .strict();
export const backupStatusSchema = z
  .object({
    configured: z.boolean(),
    unlocked: z.boolean(),
    osProtected: z.boolean(),
    localLast: z.number().int().nonnegative().nullable(),
    externalLast: z.number().int().nonnegative().nullable(),
    externalName: z.string().max(255).nullable(),
    externalPending: z.boolean(),
    message: z.string().max(400),
    archiveCount: z.number().int().nonnegative(),
  })
  .strict();
export const restorePreviewSchema = z
  .object({
    token: z.uuid(),
    pharmacyName: z.string().max(120),
    capturedAt: z.number().int().nonnegative(),
    datasetId: z.uuid(),
    revision: z.number().int().nonnegative(),
    differentDataset: z.boolean(),
    damagedLocal: z.boolean(),
    customers: z.number().int().nonnegative(),
    medicines: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative(),
  })
  .strict();
export const restoreResultSchema = z
  .object({ restored: z.literal(true), backupCreated: z.boolean() })
  .strict();
export type BackupStatus = z.infer<typeof backupStatusSchema>;
export type BackupAccess = z.infer<typeof backupAccessSchema>;
export type RestorePreview = z.infer<typeof restorePreviewSchema>;
export type RestoreInput = z.infer<typeof restoreInputSchema>;
export type RestoreConfirm = z.infer<typeof restoreConfirmSchema>;
