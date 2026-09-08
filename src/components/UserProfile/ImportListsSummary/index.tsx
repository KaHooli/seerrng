import Badge from '@app/components/Common/Badge';
import defineMessages from '@app/utils/defineMessages';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import { ImportListSyncStatus } from '@server/constants/importList';
import type { ImportListSummaryResponse } from '@server/interfaces/api/importListInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.ImportListsSummary', {
  importLists: 'Import Lists',
  listsConfigured: 'Lists Configured',
  listsEnabled: 'Enabled',
  itemsTracked: 'Items Tracked',
  requestedLastSync: 'Requested Last Sync',
  lastSynced: 'Last Synced',
  never: 'Never',
  listsFailing:
    '{count, plural, one {# list is failing} other {# lists are failing}}',
  statusSuccess: 'Synced',
  statusPartial: 'Problems',
  statusError: 'Failed',
  statusNever: 'Not yet synced',
});

type ImportListsSummaryProps = {
  userId: number;
  /** Where the "see all" arrow goes; differs for /profile and /users/:id. */
  settingsHref: string;
};

const statusBadgeType = (status: ImportListSyncStatus) => {
  switch (status) {
    case ImportListSyncStatus.SUCCESS:
      return 'success' as const;
    case ImportListSyncStatus.PARTIAL:
      return 'warning' as const;
    case ImportListSyncStatus.ERROR:
      return 'danger' as const;
    default:
      return 'default' as const;
  }
};

/**
 * Dashboard card summarizing a user's import lists. Rendered on the profile
 * beneath the quota tiles, and deliberately built from the same markup so the
 * two read as one dashboard.
 *
 * Renders nothing at all when the user has no lists — an empty card on every
 * profile would be noise for the many installs that never use the feature.
 */
const ImportListsSummary = ({
  userId,
  settingsHref,
}: ImportListsSummaryProps) => {
  const intl = useIntl();
  const { data, error } = useSWR<ImportListSummaryResponse>(
    `/api/v1/user/${userId}/importlists/summary`
  );

  if (error || !data || data.total === 0) {
    return null;
  }

  const statusLabel = (status: ImportListSyncStatus) => {
    switch (status) {
      case ImportListSyncStatus.SUCCESS:
        return intl.formatMessage(messages.statusSuccess);
      case ImportListSyncStatus.PARTIAL:
        return intl.formatMessage(messages.statusPartial);
      case ImportListSyncStatus.ERROR:
        return intl.formatMessage(messages.statusError);
      default:
        return intl.formatMessage(messages.statusNever);
    }
  };

  return (
    <>
      <div className="slider-header">
        <Link href={settingsHref} className="slider-title">
          <span>{intl.formatMessage(messages.importLists)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>
      <div className="relative z-40">
        <dl className="grid grid-cols-2 gap-5 lg:grid-cols-4">
          <div className="overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ring-gray-700 sm:p-6">
            <dt className="truncate text-sm font-bold text-gray-300">
              {intl.formatMessage(messages.listsConfigured)}
            </dt>
            <dd className="mt-1 flex items-center text-sm text-white">
              <span className="text-3xl font-semibold">{data.total}</span>
              <span className="ml-2 text-gray-400">
                {intl.formatMessage(messages.listsEnabled)}: {data.enabled}
              </span>
            </dd>
          </div>

          <div className="overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ring-gray-700 sm:p-6">
            <dt className="truncate text-sm font-bold text-gray-300">
              {intl.formatMessage(messages.itemsTracked)}
            </dt>
            <dd className="mt-1 flex items-center text-sm text-white">
              <span className="text-3xl font-semibold">{data.itemCount}</span>
            </dd>
          </div>

          <div className="overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ring-gray-700 sm:p-6">
            <dt className="truncate text-sm font-bold text-gray-300">
              {intl.formatMessage(messages.requestedLastSync)}
            </dt>
            <dd className="mt-1 flex items-center text-sm text-white">
              <span className="text-3xl font-semibold">
                {data.lastRequestedCount}
              </span>
            </dd>
          </div>

          <div
            className={`overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ${
              data.errored
                ? 'bg-gradient-to-t from-red-900 to-transparent ring-red-500'
                : 'ring-gray-700'
            } sm:p-6`}
          >
            <dt
              className={`truncate text-sm font-bold ${
                data.errored ? 'text-red-500' : 'text-gray-300'
              }`}
            >
              {intl.formatMessage(messages.lastSynced)}
            </dt>
            <dd
              className={`mt-1 flex flex-col text-sm ${
                data.errored ? 'text-red-500' : 'text-white'
              }`}
            >
              <span className="text-xl font-semibold">
                {data.lastSyncedAt
                  ? intl.formatDate(data.lastSyncedAt, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: 'numeric',
                    })
                  : intl.formatMessage(messages.never)}
              </span>
              {data.errored > 0 && (
                <span className="mt-1 text-xs">
                  {intl.formatMessage(messages.listsFailing, {
                    count: data.errored,
                  })}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <ul className="mt-4 space-y-2">
          {data.lists.map((list) => (
            <li
              key={`import-list-summary-${list.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-800/50 px-4 py-3 ring-1 ring-gray-700"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-white">
                  {list.name}
                </div>
                <div className="text-xs text-gray-400">
                  {list.providerLabel}
                  {list.lastSyncError ? ` · ${list.lastSyncError}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">
                  {list.itemCount} / {list.lastRequestedCount}
                </span>
                <Badge badgeType={statusBadgeType(list.lastSyncStatus)}>
                  {statusLabel(list.lastSyncStatus)}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};

export default ImportListsSummary;
