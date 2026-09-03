import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { extractThemeArchive, parseGithubRepositoryUrl } from './installer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

const writeField = (
  header: Buffer,
  value: string,
  offset: number,
  length: number
) => header.write(value, offset, length, 'ascii');

const createArchive = (
  entries: { name: string; content: string; type?: string }[]
) => {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content);
    const header = Buffer.alloc(512);
    writeField(header, entry.name, 0, 100);
    writeField(header, '0000600\0', 100, 8);
    writeField(header, '0000000\0', 108, 8);
    writeField(header, '0000000\0', 116, 8);
    writeField(
      header,
      `${content.length.toString(8).padStart(11, '0')}\0`,
      124,
      12
    );
    writeField(header, '00000000000\0', 136, 12);
    header.fill(32, 148, 156);
    writeField(header, entry.type ?? '0', 156, 1);
    writeField(header, 'ustar\0', 257, 6);
    writeField(header, '00', 263, 2);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeField(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, content);
    if (content.length % 512) {
      blocks.push(Buffer.alloc(512 - (content.length % 512)));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
};

const makeDestination = async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'seerr-theme-archive-')
  );
  temporaryDirectories.push(directory);
  return directory;
};

describe('GitHub theme source validation', () => {
  it('normalizes an HTTPS repository URL', () => {
    assert.deepEqual(
      parseGithubRepositoryUrl('https://github.com/KaHooli/example.git/'),
      {
        owner: 'KaHooli',
        repository: 'example',
        normalizedUrl: 'https://github.com/KaHooli/example',
      }
    );
  });

  it('rejects non-GitHub and repository sub-path URLs', () => {
    assert.throws(() => parseGithubRepositoryUrl('http://github.com/a/b'));
    assert.throws(() => parseGithubRepositoryUrl('https://example.com/a/b'));
    assert.throws(() =>
      parseGithubRepositoryUrl('https://github.com/a/b/releases')
    );
  });
});

describe('theme archive extraction', () => {
  it('extracts regular files from a checked ustar archive', async () => {
    const destination = await makeDestination();
    await extractThemeArchive(
      createArchive([{ name: 'example/theme.json', content: '{}' }]),
      destination
    );
    assert.equal(
      await fs.readFile(path.join(destination, 'example/theme.json'), 'utf8'),
      '{}'
    );
  });

  it('blocks traversal paths and link entries', async () => {
    const traversalDestination = await makeDestination();
    await assert.rejects(
      extractThemeArchive(
        createArchive([{ name: '../escape.txt', content: 'unsafe' }]),
        traversalDestination
      ),
      /unsafe path/i
    );

    const linkDestination = await makeDestination();
    await assert.rejects(
      extractThemeArchive(
        createArchive([{ name: 'link', content: '', type: '2' }]),
        linkDestination
      ),
      /unsupported links/i
    );
  });

  it('accepts pax global and extended headers around real entries', async () => {
    const destination = await makeDestination();
    await extractThemeArchive(
      createArchive([
        { name: 'pax_global_header', content: '52 comment=abc\n', type: 'g' },
        {
          name: 'PaxHeaders/theme.json',
          content: '20 SCHILY.dev=1\n',
          type: 'x',
        },
        { name: 'example/theme.json', content: '{}' },
      ]),
      destination
    );
    assert.equal(
      await fs.readFile(path.join(destination, 'example/theme.json'), 'utf8'),
      '{}'
    );
    assert.equal(
      await fs
        .access(path.join(destination, 'pax_global_header'))
        .then(() => true)
        .catch(() => false),
      false
    );
  });

  it('ignores a pax path record instead of honouring it', async () => {
    const destination = await makeDestination();
    // A conforming tar would extract this as ../escape.txt. Skipping pax data
    // means the validated ustar name wins, which is stricter, not looser.
    await extractThemeArchive(
      createArchive([
        { name: 'PaxHeaders/x', content: '25 path=../escape.txt\n', type: 'x' },
        { name: 'example/theme.json', content: '{}' },
      ]),
      destination
    );
    assert.equal(
      await fs.readFile(path.join(destination, 'example/theme.json'), 'utf8'),
      '{}'
    );
  });

  it('caps the total number of archive entries', async () => {
    const entries = Array.from({ length: 600 }, (_, index) => ({
      name: `example/dir-${index}/`,
      content: '',
      type: '5',
    }));
    await assert.rejects(
      extractThemeArchive(createArchive(entries), await makeDestination()),
      /extraction limits/i
    );
  });

  it('rejects archives with a modified tar header', async () => {
    const archive = createArchive([{ name: 'theme.json', content: '{}' }]);
    const tar = (await import('node:zlib')).gunzipSync(archive);
    tar[0] ^= 1;
    await assert.rejects(
      extractThemeArchive(gzipSync(tar), await makeDestination()),
      /checksum/i
    );
  });
});
