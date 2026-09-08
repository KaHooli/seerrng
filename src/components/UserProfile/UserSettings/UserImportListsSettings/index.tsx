import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Table from '@app/components/Common/Table';
import AddImportListModal from '@app/components/UserProfile/UserSettings/UserImportListsSettings/AddImportListModal';
import useToasts from '@app/hooks/useToasts';
import { getPositiveQueryParamNumber } from '@app/hooks/useUpdateQueryParams';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowPathIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid';
import {
  ImportListMode,
  ImportListSyncStatus,
} from '@server/constants/importList';
import type {
  ImportListResponse,
  ImportListSyncResultResponse,
  ImportListsResponse,
} from '@server/interfaces/api/importListInterfaces';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.UserProfile.UserSettings.UserImportListsSettings',
  {
    importLists: 'Import Lists',
    importListsHint:
      'Lists you subscribe to here are synced on a schedule. Anything new on a list is requested as you, using your own permissions and quota.',
    noLists:
      'You have not set up any import lists yet. Add one to start syncing.',
    addList: 'Add List',
    listName: 'List',
    provider: 'Provider',
    onSync: 'On Sync',
    lastSynced: 'Last Synced',
    status: 'Status',
    never: 'Never',
    modeRequest: 'Request',
    modeWatchlist: 'Watchlist',
    statusNever: 'Not yet synced',
    statusSuccess: 'Synced',
    statusPartial: 'Synced with problems',
    statusError: 'Failed',
    enabled: 'Enabled',
    disabled: 'Disabled',
    syncNow: 'Sync Now',
    syncing: 'Syncing…',
    enable: 'Enable',
    disable: 'Disable',
    delete: 'Delete',
    itemsSummary:
      '{items, plural, one {# item} other {# items}} · {requested, plural, one {# requested} other {# requested}}',
    syncSuccess:
      'Synced {name}: {requested, plural, one {# request} other {# requests}} created.',
    syncFailed: 'Could not sync {name}.',
    deleteSuccess: 'Import list deleted.',
    deleteFailed: 'Could not delete that import list.',
    updateFailed: 'Could not update that import list.',
    noPermissionDescription:
      "You do not have permission to modify this user's import lists.",
  }
);

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

const UserImportListsSettings = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const userId = getPositiveQueryParamNumber(router.query.userId);
  const { user } = useUser({ id: userId });

  const { data, error, mutate } = useSWR<ImportListsResponse>(
    user ? `/api/v1/user/${user.id}/importlists` : null
  );

  const [showAddModal, setShowAddModal] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);

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

  const syncNow = async (list: ImportListResponse) => {
    setSyncingId(list.id);
    try {
      const response = await axios.post<ImportListSyncResultResponse>(
        `/api/v1/user/${user?.id}/importlists/${list.id}/sync`
      );
      addToast(
        intl.formatMessage(messages.syncSuccess, {
          name: list.name,
          requested: response.data.requested,
        }),
        { appearance: 'success', autoDismiss: true }
      );
    } catch {
      addToast(intl.formatMessage(messages.syncFailed, { name: list.name }), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setSyncingId(null);
      await mutate();
    }
  };

  const toggleEnabled = async (list: ImportListResponse) => {
    try {
      await axios.put(`/api/v1/user/${user?.id}/importlists/${list.id}`, {
        enabled: !list.enabled,
      });
    } catch {
      addToast(intl.formatMessage(messages.updateFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
    await mutate();
  };

  const deleteList = async (list: ImportListResponse) => {
    try {
      await axios.delete(`/api/v1/user/${user?.id}/importlists/${list.id}`);
      addToast(intl.formatMessage(messages.deleteSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch {
      addToast(intl.formatMessage(messages.deleteFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
    await mutate();
  };

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <>
        <div className="mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.importLists)}
          </h3>
        </div>
        <Alert
          title={intl.formatMessage(messages.noPermissionDescription)}
          type="error"
        />
      </>
    );
  }

  const lists = data?.results ?? [];

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.importLists),
          intl.formatMessage(globalMessages.usersettings),
          user?.displayName,
        ]}
      />
      {showAddModal && user && (
        <AddImportListModal
          userId={user.id}
          providers={data?.providers ?? []}
          bookshelfConfigured={data?.bookshelfConfigured ?? false}
          onCancel={() => setShowAddModal(false)}
          onCreated={async () => {
            setShowAddModal(false);
            await mutate();
          }}
        />
      )}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h3 className="heading">
            {intl.formatMessage(messages.importLists)}
          </h3>
          <h6 className="description">
            {intl.formatMessage(messages.importListsHint)}
          </h6>
        </div>
        <Button buttonType="primary" onClick={() => setShowAddModal(true)}>
          <PlusIcon />
          <span>{intl.formatMessage(messages.addList)}</span>
        </Button>
      </div>

      {lists.length === 0 ? (
        <Alert title={intl.formatMessage(messages.noLists)} type="info" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Table.TH>{intl.formatMessage(messages.listName)}</Table.TH>
              <Table.TH>{intl.formatMessage(messages.provider)}</Table.TH>
              <Table.TH>{intl.formatMessage(messages.onSync)}</Table.TH>
              <Table.TH>{intl.formatMessage(messages.lastSynced)}</Table.TH>
              <Table.TH>{intl.formatMessage(messages.status)}</Table.TH>
              <Table.TH className="text-right">
                {intl.formatMessage(globalMessages.settings)}
              </Table.TH>
            </tr>
          </thead>
          <Table.TBody>
            {lists.map((list) => (
              <tr key={`import-list-${list.id}`}>
                <Table.TD>
                  <div className="font-medium text-white">{list.name}</div>
                  <div className="text-sm text-gray-400">{list.listId}</div>
                  <div className="mt-1 text-xs text-gray-400">
                    {intl.formatMessage(messages.itemsSummary, {
                      items: list.itemCount,
                      requested: list.lastRequestedCount,
                    })}
                  </div>
                </Table.TD>
                <Table.TD>{list.providerLabel}</Table.TD>
                <Table.TD>
                  {intl.formatMessage(
                    list.mode === ImportListMode.WATCHLIST
                      ? messages.modeWatchlist
                      : messages.modeRequest
                  )}
                  {list.is4k && <Badge className="ml-2">4K</Badge>}
                </Table.TD>
                <Table.TD>
                  {list.lastSyncedAt
                    ? intl.formatDate(list.lastSyncedAt, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric',
                      })
                    : intl.formatMessage(messages.never)}
                </Table.TD>
                <Table.TD>
                  <Badge badgeType={statusBadgeType(list.lastSyncStatus)}>
                    {statusLabel(list.lastSyncStatus)}
                  </Badge>
                  {!list.enabled && (
                    <Badge className="ml-2">
                      {intl.formatMessage(messages.disabled)}
                    </Badge>
                  )}
                  {list.lastSyncError && (
                    <div className="mt-1 max-w-md text-xs text-red-400">
                      {list.lastSyncError}
                    </div>
                  )}
                </Table.TD>
                <Table.TD className="flex flex-wrap justify-end gap-2">
                  <Button
                    buttonType="warning"
                    buttonSize="sm"
                    onClick={() => toggleEnabled(list)}
                  >
                    <span>
                      {intl.formatMessage(
                        list.enabled ? messages.disable : messages.enable
                      )}
                    </span>
                  </Button>
                  <Button
                    buttonType="primary"
                    buttonSize="sm"
                    disabled={syncingId === list.id}
                    onClick={() => syncNow(list)}
                  >
                    <ArrowPathIcon />
                    <span>
                      {intl.formatMessage(
                        syncingId === list.id
                          ? messages.syncing
                          : messages.syncNow
                      )}
                    </span>
                  </Button>
                  <ConfirmButton
                    onClick={() => deleteList(list)}
                    confirmText={intl.formatMessage(globalMessages.areyousure)}
                  >
                    <TrashIcon />
                    <span>{intl.formatMessage(messages.delete)}</span>
                  </ConfirmButton>
                </Table.TD>
              </tr>
            ))}
          </Table.TBody>
        </Table>
      )}
    </>
  );
};

export default UserImportListsSettings;
