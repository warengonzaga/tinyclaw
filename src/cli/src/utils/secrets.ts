import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { theme } from '../ui/theme.js';

type ErrorWithCode = Error & { code?: string };

export function resolveSecretsStorePath(): string {
  return process.env.TINYCLAW_SECRETS_DIR || join(homedir(), '.secrets-engine');
}

export function isSecretsIntegrityError(err: unknown): err is ErrorWithCode {
  return err instanceof Error && 'code' in err && (err as ErrorWithCode).code === 'INTEGRITY_ERROR';
}

function quoteForPosixShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getManualRemovalCommand(storePath: string): string {
  if (platform() === 'win32') {
    return `Remove-Item -Recurse -Force ${quoteForPowerShell(storePath)}`;
  }

  return `rm -rf ${quoteForPosixShell(storePath)}`;
}

export function printSecretsIntegrityRecovery(nextCommand: string): void {
  const storePath = resolveSecretsStorePath();

  console.log();
  console.log(theme.error('  ✖ Secrets store integrity check failed.'));
  console.log();
  console.log('    The store HMAC no longer matches the database contents.');
  console.log('    This usually means corruption, a changed keyfile, or machine-identity drift.');
  console.log();
  console.log('    Fast recovery:');
  console.log();
  console.log(`      1. ${theme.cmd('tinyclaw purge --force --yes')}`);
  console.log(`      2. ${theme.cmd(nextCommand)}`);
  console.log();
  console.log('    Manual recovery:');
  console.log();
  console.log(`      ${theme.cmd(getManualRemovalCommand(storePath))}`);
  console.log();
}