import type { AllSettings } from '@server/lib/settings';
import { describe, expect, it } from 'vitest';
import moveImportListPermissionBit from './0014_move_import_list_permission_bit';

const LEGACY_BIT = 137438953472;
const NEW_BIT = 4503599627370496;
const REQUEST = 32;

const run = (defaultPermissions: number, migrations: string[]) =>
  moveImportListPermissionBit({
    main: { defaultPermissions },
    migrations,
  } as unknown as AllSettings) as unknown as {
    main: { defaultPermissions: number };
    migrations: string[];
  };

describe('import-list permission bit settings migration', () => {
  it('moves the legacy bit for settings written by an earlier fork build', () => {
    const result = run(REQUEST + LEGACY_BIT, ['0015_add_import_list_sync_job']);
    expect(result.main.defaultPermissions).toBe(REQUEST + NEW_BIT);
    expect(result.migrations).toContain('0014_move_import_list_permission_bit');
  });

  it('keeps 2^37 as comic auto-approve for settings that never ran the fork', () => {
    const result = run(REQUEST + LEGACY_BIT, ['0015_enable_default_http_auth']);
    expect(result.main.defaultPermissions).toBe(REQUEST + LEGACY_BIT);
  });

  it('runs only once', () => {
    const result = run(REQUEST + LEGACY_BIT, [
      '0015_add_import_list_sync_job',
      '0014_move_import_list_permission_bit',
    ]);
    expect(result.main.defaultPermissions).toBe(REQUEST + LEGACY_BIT);
  });
});
