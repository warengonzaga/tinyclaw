/**
 * Tests for parseTar — ensuring symlink (typeflag '2') and hardlink (typeflag '1')
 * entries are correctly detected and returned.
 */

import { describe, expect, test } from 'bun:test';
import { parseTar } from '../../src/commands/backup.js';

const TAR_BLOCK = 512;

/**
 * Build a minimal tar header with the given name, typeflag, size, and optional linkname.
 */
function makeTarHeader(
  name: string,
  typeflag: string,
  size: number = 0,
  linkname: string = '',
): Buffer {
  const header = Buffer.alloc(TAR_BLOCK);

  // name (0-99)
  header.write(name, 0, Math.min(name.length, 100), 'utf-8');

  // mode (100-107)
  const mode = typeflag === '5' ? '0000755\0' : '0000644\0';
  header.write(mode, 100, 8, 'utf-8');

  // uid (108-115)
  header.write('0000000\0', 108, 8, 'utf-8');
  // gid (116-123)
  header.write('0000000\0', 116, 8, 'utf-8');

  // size (124-135) — octal, 11 digits + NUL
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');

  // mtime (136-147)
  header.write('00000000000\0', 136, 12, 'utf-8');

  // checksum placeholder (148-155) — 8 spaces
  header.write('        ', 148, 8, 'utf-8');

  // typeflag (156)
  header.write(typeflag, 156, 1, 'utf-8');

  // linkname (157-256)
  if (linkname) {
    header.write(linkname, 157, Math.min(linkname.length, 100), 'utf-8');
  }

  // magic (257-262)
  header.write('ustar\0', 257, 6, 'utf-8');
  // version (263-264)
  header.write('00', 263, 2, 'utf-8');

  // Compute checksum
  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    checksum += header[i];
  }
  const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.write(checksumStr, 148, 8, 'utf-8');

  return header;
}

/** Build end-of-archive marker (two zero blocks). */
function tarEnd(): Buffer {
  return Buffer.alloc(TAR_BLOCK * 2);
}

describe('parseTar', () => {
  test('parses a regular file entry', () => {
    const content = Buffer.from('hello world');
    const header = makeTarHeader('test.txt', '0', content.length);
    const dataBlock = Buffer.alloc(TAR_BLOCK);
    content.copy(dataBlock);
    const tar = Buffer.concat([header, dataBlock, tarEnd()]);

    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('file');
    expect(entries[0].name).toBe('test.txt');
    expect(entries[0].data.toString()).toBe('hello world');
  });

  test('parses a directory entry (typeflag 5)', () => {
    const header = makeTarHeader('mydir/', '5');
    const tar = Buffer.concat([header, tarEnd()]);

    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('directory');
    expect(entries[0].name).toBe('mydir/');
  });

  test('parses a symlink entry (typeflag 2)', () => {
    const header = makeTarHeader('link.txt', '2', 0, '../target.txt');
    const tar = Buffer.concat([header, tarEnd()]);

    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('symlink');
    expect(entries[0].name).toBe('link.txt');
    expect(entries[0].linkname).toBe('../target.txt');
  });

  test('parses a hardlink entry (typeflag 1)', () => {
    const header = makeTarHeader('hardlink.txt', '1', 0, 'original.txt');
    const tar = Buffer.concat([header, tarEnd()]);

    const entries = parseTar(tar);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('hardlink');
    expect(entries[0].name).toBe('hardlink.txt');
    expect(entries[0].linkname).toBe('original.txt');
  });

  test('mixed entries: file, directory, symlink, hardlink', () => {
    const fileContent = Buffer.from('data');
    const fileHeader = makeTarHeader('file.txt', '0', fileContent.length);
    const fileData = Buffer.alloc(TAR_BLOCK);
    fileContent.copy(fileData);

    const dirHeader = makeTarHeader('subdir/', '5');
    const symlinkHeader = makeTarHeader('sym', '2', 0, 'file.txt');
    const hardlinkHeader = makeTarHeader('hard', '1', 0, 'file.txt');

    const tar = Buffer.concat([
      fileHeader, fileData,
      dirHeader,
      symlinkHeader,
      hardlinkHeader,
      tarEnd(),
    ]);

    const entries = parseTar(tar);
    expect(entries).toHaveLength(4);
    expect(entries[0].type).toBe('file');
    expect(entries[1].type).toBe('directory');
    expect(entries[2].type).toBe('symlink');
    expect(entries[3].type).toBe('hardlink');
  });
});
