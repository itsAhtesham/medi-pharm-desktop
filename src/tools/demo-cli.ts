import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createDemoProfile, demoMarker } from './demo-data';

async function main() {
  const { values, positionals } = parseArgs({
    options: { profile: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });
  if (values.help) {
    process.stdout.write(
      'pnpm seed:demo [--profile NEW_FOLDER]\npnpm dev:demo [--profile SEEDED_FOLDER]\nDefault folder: .demo-data/pharmacy\nSeeding refuses existing folders. The normal pharmacy profile is not used.\n',
    );
    return;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || !['seed', 'open'].includes(command))
    throw new Error('Use pnpm seed:demo or pnpm dev:demo.');
  const root = path.resolve(values.profile ?? '.demo-data/pharmacy');
  if (command === 'seed') {
    process.stdout.write(`Creating synthetic demo data in ${root}\n`);
    const result = await createDemoProfile(root);
    process.stdout.write(
      `Created ${result.summary.customers} customers, ${result.summary.medicines} medicines and ${result.summary.purchases} purchases (${result.summary.cancelledPurchases} cancelled).\nOwner: ${result.access.identifier}\nPassword: ${result.access.password}\nRecovery code and dataset summary: ${path.join(root, demoMarker)}\nOpen with pnpm dev:demo${values.profile ? ` --profile "${root}"` : ''}\n`,
    );
    return;
  }
  const marker = z.object({
    format: z.literal(1),
    kind: z.literal('medipharm-demo'),
    status: z.literal('ready'),
  });
  marker.parse(JSON.parse(readFileSync(path.join(root, demoMarker), 'utf8')));
  process.stdout.write(`Opening demo profile: ${root}\n`);
  const child = spawn(
    process.execPath,
    [path.resolve('node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, MEDIPHARM_PREVIEW_HOME: root },
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
      resolve();
    });
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
