/**
 * Backup Command
 *
 * Export and import Tiny Claw data for migration between machines.
 *
 * Usage:
 *   tinyclaw backup export [path]    Export a .tinyclaw backup archive
 *   tinyclaw backup import <file>    Import a .tinyclaw backup archive
 *
 * The export bundles all portable data from ~/.tinyclaw/ into a single
 * .tinyclaw archive file. Secrets (API keys, tokens) are NOT included
 * because they are machine-bound (AES-256-GCM via @wgtechlabs/secrets-engine).
 * Instead, a manifest of secret key names is embedded so the import flow
 * can prompt the owner to re-enter each value on the new machine.
 *
 * Archive format: gzipped tarball (.tar.gz) renamed to .tinyclaw
 * Contents:
 *   manifest.json          — metadata + secret key names
 *   data/                  — config.db, agent.db, security.db, etc.
 *   heartware/             — soul files (SEED.txt, identity, etc.)
 *   learning/              — learned patterns
 *   audit/                 — audit logs
 */

import { join, resolve, basename, sep } from 'path';
import { homedir } from 'os';
import { existsSync, createReadStream, createWriteStream } from 'fs';
import { readdir, stat, readFile, mkdir } from 'fs/promises';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import * as p from '@clack/prompts';
import { SecretsManager } from '@tinyclaw/secrets';
import { parseSeed, generateSoul } from '@tinyclaw/heartware';
import { setLogMode } from '@tinyclaw/logger';
import { showBanner } from '../ui/banner.js';
import { theme } from '../ui/theme.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARCHIVE_EXTENSION = '.tinyclaw';
const MANIFEST_VERSION = 1;

/** Subdirectories inside ~/.tinyclaw/ to include in export */
const EXPORTABLE_DIRS = ['data', 'heartware', 'learning', 'audit'];

/** Default directory for backup archives */
const DEFAULT_BACKUP_DIR = 'backups';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function resolveDataDir(): string {
  return process.env.TINYCLAW_DATA_DIR || join(homedir(), '.tinyclaw');
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Try to read the soul name from the SEED.txt file.
 */
async function getSoulName(dataDir: string): Promise<string | null> {
  try {
    const seedPath = join(dataDir, 'heartware', 'SEED.txt');
    const raw = await readFile(seedPath, 'utf-8');
    const seed = parseSeed(raw.trim());
    const result = generateSoul(seed);
    return result.traits.character.suggestedName;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tar packing / unpacking (minimal, header-only implementation)
//
// We use a lightweight tar builder/reader so the CLI has zero extra
// dependencies. The archive is a standard POSIX ustar tarball wrapped
// in gzip — any tar tool can open it.
// ---------------------------------------------------------------------------

const TAR_BLOCK = 512;

function encodeOctal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

function createTarHeader(name: string, size: number, mtime: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK);

  // name (0-99)
  header.write(name, 0, Math.min(name.length, 100), 'utf-8');
  // mode (100-107) — 0644
  header.write(encodeOctal(0o644, 8), 100, 8, 'utf-8');
  // uid (108-115)
  header.write(encodeOctal(0, 8), 108, 8, 'utf-8');
  // gid (116-123)
  header.write(encodeOctal(0, 8), 116, 8, 'utf-8');
  // size (124-135)
  header.write(encodeOctal(size, 12), 124, 12, 'utf-8');
  // mtime (136-147)
  header.write(encodeOctal(Math.floor(mtime / 1000), 12), 136, 12, 'utf-8');
  // checksum placeholder (148-155) — 8 spaces
  header.write('        ', 148, 8, 'utf-8');
  // typeflag (156) — '0' for regular file
  header.write('0', 156, 1, 'utf-8');
  // magic (257-262) — 'ustar\0'
  header.write('ustar\0', 257, 6, 'utf-8');
  // version (263-264) — '00'
  header.write('00', 263, 2, 'utf-8');

  // Compute checksum
  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    checksum += header[i];
  }
  header.write(encodeOctal(checksum, 7) + ' ', 148, 8, 'utf-8');

  return header;
}

function createTarDirHeader(name: string, mtime: number): Buffer {
  const dirName = name.endsWith('/') ? name : name + '/';
  const header = Buffer.alloc(TAR_BLOCK);

  header.write(dirName, 0, Math.min(dirName.length, 100), 'utf-8');
  header.write(encodeOctal(0o755, 8), 100, 8, 'utf-8');
  header.write(encodeOctal(0, 8), 108, 8, 'utf-8');
  header.write(encodeOctal(0, 8), 116, 8, 'utf-8');
  header.write(encodeOctal(0, 12), 124, 12, 'utf-8');
  header.write(encodeOctal(Math.floor(mtime / 1000), 12), 136, 12, 'utf-8');
  header.write('        ', 148, 8, 'utf-8');
  // typeflag '5' for directory
  header.write('5', 156, 1, 'utf-8');
  header.write('ustar\0', 257, 6, 'utf-8');
  header.write('00', 263, 2, 'utf-8');

  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    checksum += header[i];
  }
  header.write(encodeOctal(checksum, 7) + ' ', 148, 8, 'utf-8');

  return header;
}

/**
 * Recursively collect all files in a directory, returning relative paths.
 */
async function collectFiles(
  baseDir: string,
  prefix: string = '',
): Promise<{ relativePath: string; absolutePath: string; size: number; mtime: number }[]> {
  const results: { relativePath: string; absolutePath: string; size: number; mtime: number }[] = [];

  if (!(await dirExists(baseDir))) return results;

  const entries = await readdir(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = join(baseDir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      // Skip .backups (heartware internal) and backups/ (export archives)
      if (entry.name === '.backups' || entry.name === 'backups') continue;
      const nested = await collectFiles(absPath, relPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const fileStat = await stat(absPath);
      results.push({
        relativePath: relPath,
        absolutePath: absPath,
        size: fileStat.size,
        mtime: fileStat.mtimeMs,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface BackupManifest {
  version: number;
  createdAt: string;
  soulName: string | null;
  machine: {
    hostname: string;
    platform: string;
  };
  secretKeys: string[];
  files: string[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function exportBackup(args: string[]): Promise<void> {
  const dataDir = resolveDataDir();

  if (!(await dirExists(dataDir))) {
    p.log.error('Nothing to export — Tiny Claw hasn\'t been set up yet.');
    p.outro('Run ' + theme.cmd('tinyclaw setup') + ' to get started.');
    return;
  }

  // Resolve output path
  const soulName = await getSoulName(dataDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultFilename = `${timestamp}${ARCHIVE_EXTENSION}`;

  const outputArg = args[0];
  let outputPath: string;

  if (outputArg) {
    // If a directory was given, put the file in that directory
    if (await dirExists(outputArg)) {
      outputPath = join(resolve(outputArg), defaultFilename);
    } else {
      outputPath = resolve(outputArg);
      // Ensure it has the right extension
      if (!outputPath.endsWith(ARCHIVE_EXTENSION)) {
        outputPath += ARCHIVE_EXTENSION;
      }
    }
  } else {
    // Default to ~/.tinyclaw/backups/
    const backupDir = join(dataDir, DEFAULT_BACKUP_DIR);
    await mkdir(backupDir, { recursive: true });
    outputPath = join(backupDir, defaultFilename);
  }

  // Collect files to export
  const exportSpinner = p.spinner();
  exportSpinner.start('Collecting Tiny Claw data');

  const allFiles: { relativePath: string; absolutePath: string; size: number; mtime: number }[] = [];

  for (const dir of EXPORTABLE_DIRS) {
    const dirPath = join(dataDir, dir);
    const files = await collectFiles(dirPath, dir);
    allFiles.push(...files);
  }

  if (allFiles.length === 0) {
    exportSpinner.stop(theme.warn('No data files found'));
    p.outro('Nothing to export.');
    return;
  }

  // Collect secret key names (not values!)
  let secretKeys: string[] = [];
  try {
    const secrets = await SecretsManager.create();
    secretKeys = await secrets.list();
    await secrets.close();
  } catch {
    // Secrets engine may not be initialized — that's fine
  }

  // Build manifest
  const { hostname } = await import('os');
  const manifest: BackupManifest = {
    version: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    soulName,
    machine: {
      hostname: hostname(),
      platform: process.platform,
    },
    secretKeys,
    files: allFiles.map((f) => f.relativePath),
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestBuf = Buffer.from(manifestJson, 'utf-8');

  // Build tar archive
  const chunks: Buffer[] = [];

  // Add manifest.json
  chunks.push(createTarHeader('manifest.json', manifestBuf.length, Date.now()));
  chunks.push(manifestBuf);
  // Pad to 512-byte boundary
  const manifestPad = TAR_BLOCK - (manifestBuf.length % TAR_BLOCK);
  if (manifestPad < TAR_BLOCK) {
    chunks.push(Buffer.alloc(manifestPad));
  }

  // Track unique directories to add dir headers
  const addedDirs = new Set<string>();

  // Add data files
  for (const file of allFiles) {
    // Add directory headers for parent paths
    const parts = file.relativePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      if (!addedDirs.has(dirPath)) {
        addedDirs.add(dirPath);
        chunks.push(createTarDirHeader(dirPath, Date.now()));
      }
    }

    const content = await readFile(file.absolutePath);
    chunks.push(createTarHeader(file.relativePath, content.length, file.mtime));
    chunks.push(content);

    const filePad = TAR_BLOCK - (content.length % TAR_BLOCK);
    if (filePad < TAR_BLOCK) {
      chunks.push(Buffer.alloc(filePad));
    }
  }

  // End-of-archive marker (two 512-byte zero blocks)
  chunks.push(Buffer.alloc(TAR_BLOCK * 2));

  const tarBuffer = Buffer.concat(chunks);

  // Gzip and write
  exportSpinner.message('Compressing archive');

  const { gzipSync } = await import('zlib');
  const compressed = gzipSync(tarBuffer, { level: 9 });
  const { writeFile } = await import('fs/promises');
  await writeFile(outputPath, compressed);

  const sizeMB = (compressed.length / (1024 * 1024)).toFixed(2);
  exportSpinner.stop(theme.success(`Archive created (${sizeMB} MB)`));

  // Summary
  const summary: string[] = [];
  summary.push(`  ${theme.label('File')}       ${outputPath}`);
  summary.push(`  ${theme.label('Contents')}   ${allFiles.length} files`);
  if (soulName) {
    summary.push(`  ${theme.label('Soul')}       ${soulName}`);
  }

  if (secretKeys.length > 0) {
    summary.push('');
    summary.push(`  ${theme.label('Secret keys')} ${theme.dim('(names only — values are NOT exported)')}`);
    for (const key of secretKeys) {
      summary.push(`    ${theme.dim('•')} ${key}`);
    }
    summary.push('');
    summary.push(theme.warn('  ⚠ You\'ll need to re-enter these secret values when importing'));
    summary.push(theme.dim('    on another machine. Secrets are machine-bound and cannot be'));
    summary.push(theme.dim('    transferred.'));
  } else {
    summary.push(`  ${theme.label('Secrets')}    ${theme.dim('none')}`);
  }

  p.log.info(summary.join('\n'));
  p.outro(theme.success('Export complete!'));
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Parse a tar buffer and extract entries.
 */
function parseTar(buffer: Buffer): { name: string; type: 'file' | 'directory'; data: Buffer }[] {
  const entries: { name: string; type: 'file' | 'directory'; data: Buffer }[] = [];
  let offset = 0;

  while (offset + TAR_BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK);

    // Check for end-of-archive (all zeros)
    let allZero = true;
    for (let i = 0; i < TAR_BLOCK; i++) {
      if (header[i] !== 0) { allZero = false; break; }
    }
    if (allZero) break;

    // Parse header
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0/g, '');
    const sizeStr = header.subarray(124, 136).toString('utf-8').replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header.subarray(156, 157).toString('utf-8');

    offset += TAR_BLOCK;

    if (typeFlag === '5' || name.endsWith('/')) {
      entries.push({ name, type: 'directory', data: Buffer.alloc(0) });
    } else {
      const data = buffer.subarray(offset, offset + size);
      entries.push({ name: name, type: 'file', data: Buffer.from(data) });
      // Advance past data + padding
      const blocks = Math.ceil(size / TAR_BLOCK);
      offset += blocks * TAR_BLOCK;
    }
  }

  return entries;
}

async function importBackup(args: string[]): Promise<void> {
  const archivePath = args[0];

  if (!archivePath) {
    p.log.error('Missing archive file path.');
    p.log.info(`Usage: ${theme.cmd('tinyclaw backup import')} ${theme.dim('<file.tinyclaw>')}`);
    return;
  }

  const resolvedPath = resolve(archivePath);

  if (!(await fileExists(resolvedPath))) {
    p.log.error(`File not found: ${resolvedPath}`);
    return;
  }

  // Read and decompress
  const importSpinner = p.spinner();
  importSpinner.start('Reading archive');

  const { gunzipSync } = await import('zlib');
  const compressed = await readFile(resolvedPath);
  let tarBuffer: Buffer;

  try {
    tarBuffer = gunzipSync(compressed);
  } catch {
    importSpinner.stop(theme.error('Failed'));
    p.log.error('Invalid archive — the file may be corrupt or not a valid .tinyclaw export.');
    return;
  }

  // Parse tar
  const entries = parseTar(tarBuffer);

  // Find and parse manifest
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry || manifestEntry.type !== 'file') {
    importSpinner.stop(theme.error('Failed'));
    p.log.error('Invalid archive — missing manifest.json. This doesn\'t appear to be a Tiny Claw backup.');
    return;
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf-8'));
  } catch {
    importSpinner.stop(theme.error('Failed'));
    p.log.error('Invalid archive — manifest.json is malformed.');
    return;
  }

  if (manifest.version !== MANIFEST_VERSION) {
    importSpinner.stop(theme.error('Failed'));
    p.log.error(`Unsupported manifest version: ${manifest.version}, expected ${MANIFEST_VERSION}`);
    return;
  }

  importSpinner.stop(theme.success('Archive loaded'));

  // Show what we're about to import
  const dataDir = resolveDataDir();
  const dataExists = await dirExists(dataDir);

  const info: string[] = [];
  info.push(`  ${theme.label('Archive')}    ${basename(resolvedPath)}`);
  info.push(`  ${theme.label('Created')}    ${manifest.createdAt}`);
  if (manifest.soulName) {
    info.push(`  ${theme.label('Soul')}       ${manifest.soulName}`);
  }
  info.push(`  ${theme.label('From')}       ${manifest.machine.hostname} (${manifest.machine.platform})`);
  info.push(`  ${theme.label('Files')}      ${manifest.files.length}`);

  if (manifest.secretKeys.length > 0) {
    info.push('');
    info.push(`  ${theme.label('Secrets to re-enter')} ${theme.dim(`(${manifest.secretKeys.length} keys)`)}`);
    for (const key of manifest.secretKeys) {
      info.push(`    ${theme.dim('•')} ${key}`);
    }
  }

  p.log.info(info.join('\n'));

  // Warn if existing data will be overwritten
  if (dataExists) {
    p.log.warn(
      theme.warn('⚠ Existing Tiny Claw data found at ') + theme.dim(dataDir) + '\n' +
      theme.warn('  Importing will overwrite your current data.')
    );
  }

  // Confirm
  const proceed = await p.confirm({
    message: 'Proceed with import?',
    initialValue: false,
  });

  if (p.isCancel(proceed) || !proceed) {
    p.outro(theme.dim('Import cancelled.'));
    return;
  }

  // Extract files
  const extractSpinner = p.spinner();
  extractSpinner.start('Extracting files');

  let extracted = 0;
  const errors: string[] = [];

  const resolvedDataDir = resolve(dataDir);

  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;

    // Path traversal protection: reject absolute paths, symlinks, and '..' segments
    if (entry.type === 'symlink') {
      errors.push(`${entry.name}: skipped (symlink)`);
      continue;
    }

    const targetPath = resolve(dataDir, entry.name);
    if (!targetPath.startsWith(resolvedDataDir + sep) && targetPath !== resolvedDataDir) {
      errors.push(`${entry.name}: skipped (path traversal detected)`);
      continue;
    }

    try {
      if (entry.type === 'directory') {
        await mkdir(targetPath, { recursive: true });
      } else {
        // Ensure parent directory exists
        const { dirname } = await import('path');
        await mkdir(dirname(targetPath), { recursive: true });
        const { writeFile } = await import('fs/promises');
        await writeFile(targetPath, entry.data);
        extracted++;
      }
    } catch (err) {
      errors.push(`${entry.name}: ${String(err)}`);
    }
  }

  if (errors.length > 0) {
    extractSpinner.stop(theme.warn('Extracted with errors'));
    for (const error of errors) {
      p.log.error(error);
    }
  } else {
    extractSpinner.stop(theme.success(`Extracted ${extracted} files`));
  }

  // Prompt for secrets re-entry
  if (manifest.secretKeys.length > 0) {
    p.log.step('');
    p.log.info(
      theme.label('Secret Re-entry') + '\n\n' +
      '  Your previous install had secrets that need to be re-entered.\n' +
      '  Secrets are machine-bound and cannot be transferred between machines.\n' +
      '  Each value will be encrypted with this machine\'s identity.\n'
    );

    let secrets: SecretsManager | null = null;
    try {
      secrets = await SecretsManager.create();
    } catch (err) {
      p.log.error(`Failed to initialize secrets engine: ${String(err)}`);
      p.log.info(
        'You can manually re-enter secrets later via ' +
        theme.cmd('tinyclaw setup') + '.'
      );
    }

    if (secrets) {
      let stored = 0;
      let skipped = 0;

      for (const key of manifest.secretKeys) {
        // Check if this key already exists on this machine
        const exists = await secrets.check(key);
        if (exists) {
          const overwrite = await p.confirm({
            message: `Secret ${theme.label(key)} already exists on this machine. Overwrite?`,
            initialValue: false,
          });

          if (p.isCancel(overwrite) || !overwrite) {
            skipped++;
            continue;
          }
        }

        const value = await p.password({
          message: `Enter value for ${theme.label(key)}`,
        });

        if (p.isCancel(value)) {
          p.log.warn('Remaining secrets skipped. You can re-enter them later.');
          skipped += manifest.secretKeys.length - stored - skipped;
          break;
        }

        if (value && value.trim()) {
          await secrets.store(key, value.trim());
          stored++;
        } else {
          skipped++;
        }
      }

      await secrets.close();

      const secretSummary: string[] = [];
      if (stored > 0) secretSummary.push(`${theme.success('✓')} ${stored} secret(s) stored`);
      if (skipped > 0) secretSummary.push(`${theme.dim('○')} ${skipped} secret(s) skipped`);
      p.log.info(secretSummary.join('  '));

      if (skipped > 0) {
        p.log.info(
          theme.dim('  Skipped secrets can be added later via ') +
          theme.cmd('tinyclaw setup') +
          theme.dim('.')
        );
      }
    }
  }

  p.outro(
    theme.success('Import complete!') + ' Run ' + theme.cmd('tinyclaw start') + ' to boot your Tiny Claw.'
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log();
  console.log('  ' + theme.label('Usage'));
  console.log(`    ${theme.cmd('tinyclaw backup export')} ${theme.dim('[path]')}     Export a .tinyclaw backup archive`);
  console.log(`    ${theme.cmd('tinyclaw backup import')} ${theme.dim('<file>')}     Import a .tinyclaw backup archive`);
  console.log();
  console.log('  ' + theme.label('Export'));
  console.log(`    Bundles all portable data (heartware, config, memory, learning)`);
  console.log(`    into a single .tinyclaw file. Secrets are ${theme.warn('NOT')} included — only`);
  console.log(`    their key names are saved so you know what to re-enter on import.`);
  console.log(`    Saved to ~/.tinyclaw/backups/ by default. Use ${theme.dim('.')} for current directory.`);
  console.log();
  console.log('  ' + theme.label('Import'));
  console.log(`    Extracts the archive into ~/.tinyclaw/ and prompts you to`);
  console.log(`    re-enter any secret values (API keys, tokens, etc).`);
  console.log();
  console.log('  ' + theme.label('Examples'));
  console.log(`    ${theme.dim('$')} tinyclaw backup export`);
  console.log(`    ${theme.dim('$')} tinyclaw backup export .`);
  console.log(`    ${theme.dim('$')} tinyclaw backup import 2026-02-17T18-15-30.tinyclaw`);
  console.log();
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export async function backupCommand(args: string[] = []): Promise<void> {
  setLogMode('error');
  showBanner();

  const subcommand = args[0];

  switch (subcommand) {
    case 'export': {
      p.intro(theme.brand('Backup — Export'));
      await exportBackup(args.slice(1));
      break;
    }

    case 'import': {
      p.intro(theme.brand('Backup — Import'));
      await importBackup(args.slice(1));
      break;
    }

    case '--help':
    case '-h':
    case undefined: {
      printHelp();
      break;
    }

    default: {
      console.log(theme.error(`  Unknown subcommand: ${subcommand}`));
      printHelp();
      process.exit(1);
    }
  }
}
