import type { AllSettings } from '@server/lib/settings';

type MutableSettings = {
  jobs?: Record<string, { schedule: string; enabled?: boolean }>;
  importLists?: Record<string, unknown>;
  migrations?: string[];
};

const MIGRATION_NAME = '0015_add_import_list_sync_job';

const addImportListSyncJob = (settings: AllSettings): AllSettings => {
  const mutableSettings = settings as unknown as MutableSettings;

  if (
    Array.isArray(mutableSettings.migrations) &&
    mutableSettings.migrations.includes(MIGRATION_NAME)
  ) {
    return settings;
  }

  if (!mutableSettings.jobs) {
    mutableSettings.jobs = {};
  }

  if (!mutableSettings.jobs['import-list-sync']) {
    mutableSettings.jobs['import-list-sync'] = {
      schedule: '0 0 */12 * * *',
      enabled: true,
    };
  }

  mutableSettings.jobs['import-list-sync'].enabled ??= true;

  if (!mutableSettings.importLists) {
    mutableSettings.importLists = {};
  }

  const importLists = mutableSettings.importLists;
  importLists.enabled ??= true;
  importLists.maxItemsPerList ??= 500;
  importLists.syncConcurrency ??= 2;
  importLists.defaultMode ??= 'request';
  importLists.traktClientId ??= '';
  importLists.tvdbApiKey ??= '';
  importLists.mdblistApiKey ??= '';

  if (!Array.isArray(mutableSettings.migrations)) {
    mutableSettings.migrations = [];
  }
  mutableSettings.migrations.push(MIGRATION_NAME);

  return settings;
};

export default addImportListSyncJob;
