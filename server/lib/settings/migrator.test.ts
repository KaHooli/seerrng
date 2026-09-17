import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import path from 'node:path';
import { getSettingsBackupPath, getSettingsMigrationFiles } from './migrator';

describe('settings migration file handling', () => {
  it('keeps backups beside settings when parent paths contain .json', () => {
    assert.strictEqual(
      getSettingsBackupPath('/config/archive.json/data/settings.json'),
      path.normalize('/config/archive.json/data/settings.old.json')
    );
  });

  it('runs only migration modules in deterministic filename order', () => {
    assert.deepStrictEqual(
      getSettingsMigrationFiles([
        '0010_last.ts',
        'README.md',
        '0002_second.js',
        '0001_first.ts',
      ]),
      ['0001_first.ts', '0002_second.js', '0010_last.ts']
    );
  });

  it('skips the unit tests that sit beside the migrations', () => {
    // These export no migration function, so importing one aborts startup.
    assert.deepStrictEqual(
      getSettingsMigrationFiles([
        '0015_enable_default_http_auth.ts',
        '0015_enable_default_http_auth.test.ts',
        '0016_something.test.js',
      ]),
      ['0015_enable_default_http_auth.ts']
    );
  });
});
