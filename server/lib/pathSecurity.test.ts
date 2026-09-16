import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  assertNoSymlinkDirectoryComponents,
  isTolerableChmodError,
  resetReportedChmodFailures,
  shouldReportChmodFailure,
} from './pathSecurity';

const posixIt = process.platform === 'win32' ? it.skip : it;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('assertNoSymlinkDirectoryComponents', () => {
  posixIt('rejects symlinks in non-final path components', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-path-'));
    temporaryDirectories.push(root);
    const target = path.join(root, 'target');
    const linked = path.join(root, 'linked');
    await fs.mkdir(path.join(target, 'nested'), { recursive: true });
    await fs.symlink(target, linked);

    assert.throws(
      () =>
        assertNoSymlinkDirectoryComponents(path.join(linked, 'nested'), {
          label: 'Sensitive directory',
        }),
      /must not contain symlinks/
    );
  });

  it('allows a missing suffix only when requested', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-path-'));
    temporaryDirectories.push(root);
    const missing = path.join(root, 'new', 'nested');

    assert.doesNotThrow(() =>
      assertNoSymlinkDirectoryComponents(missing, { allowMissing: true })
    );
    assert.throws(() => assertNoSymlinkDirectoryComponents(missing), /ENOENT/);
  });
});

describe('tolerable chmod failures', () => {
  beforeEach(() => {
    resetReportedChmodFailures();
  });

  it('treats the codes a read-only or foreign-owned mount returns as tolerable', () => {
    for (const code of ['EPERM', 'EROFS', 'ENOSYS']) {
      assert.equal(isTolerableChmodError({ code }), true, code);
    }
  });

  it('leaves a genuine failure fatal', () => {
    for (const code of ['EACCES', 'ENOENT', 'EIO', undefined]) {
      assert.equal(isTolerableChmodError({ code }), false, String(code));
    }
    assert.equal(isTolerableChmodError(new Error('boom')), false);
  });

  it('reports a path once however often the chmod is retried', () => {
    // The settings file is hardened on every read, write and lock acquisition,
    // so a scan that saves settings in a loop would otherwise repeat the same
    // warning indefinitely.
    assert.equal(shouldReportChmodFailure('/app/config'), true);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      assert.equal(shouldReportChmodFailure('/app/config'), false);
    }
  });

  it('reports each distinct path on its own', () => {
    assert.equal(shouldReportChmodFailure('/app/config'), true);
    assert.equal(shouldReportChmodFailure('/app/config/settings.json'), true);
    assert.equal(shouldReportChmodFailure('/app/config'), false);
    assert.equal(shouldReportChmodFailure('/app/config/settings.json'), false);
  });
});
