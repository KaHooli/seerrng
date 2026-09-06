import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  isTolerableChmodError,
  resetReportedChmodFailures,
  shouldReportChmodFailure,
} from './pathSecurity';

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
