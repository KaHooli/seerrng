import type { AllSettings } from '@server/lib/settings';

type MutableSettings = {
  main?: { defaultPermissions?: number };
  migrations?: string[];
};

const MIGRATION_NAME = '0014_move_import_list_permission_bit';
const IMPORT_LIST_SYNC_MIGRATION = '0015_add_import_list_sync_job';
const LEGACY_IMPORT_LIST_BIT = 2n ** 37n;
const IMPORT_LIST_BIT = 2n ** 52n;

/**
 * MANAGE_IMPORT_LISTS moved from 2^37, which upstream later assigned to
 * AUTO_APPROVE_COMIC, to 2^52. This file sorts before the import-list sync
 * migration, so that migration having already been recorded means these
 * settings were written by an earlier SeerrNG build of this fork, where 2^37
 * could only mean "manage import lists". Settings from a fresh install or from
 * upstream keep 2^37 as the comic auto-approve permission.
 */
const moveImportListPermissionBit = (settings: AllSettings): AllSettings => {
  const mutableSettings = settings as unknown as MutableSettings;
  const migrations = Array.isArray(mutableSettings.migrations)
    ? mutableSettings.migrations
    : [];

  if (migrations.includes(MIGRATION_NAME)) {
    return settings;
  }

  const defaultPermissions = mutableSettings.main?.defaultPermissions;
  if (
    migrations.includes(IMPORT_LIST_SYNC_MIGRATION) &&
    mutableSettings.main &&
    typeof defaultPermissions === 'number' &&
    Number.isSafeInteger(defaultPermissions) &&
    defaultPermissions >= 0
  ) {
    const value = BigInt(defaultPermissions);
    if ((value & LEGACY_IMPORT_LIST_BIT) !== 0n) {
      mutableSettings.main.defaultPermissions = Number(
        (value & ~LEGACY_IMPORT_LIST_BIT) | IMPORT_LIST_BIT
      );
    }
  }

  mutableSettings.migrations = [...migrations, MIGRATION_NAME];

  return settings;
};

export default moveImportListPermissionBit;
