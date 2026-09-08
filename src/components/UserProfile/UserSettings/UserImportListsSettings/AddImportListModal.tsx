import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import type { ImportListProviderId } from '@server/constants/importList';
import {
  ImportListBookFormat,
  ImportListMode,
} from '@server/constants/importList';
import type {
  ImportListProviderInfo,
  ImportListResponse,
} from '@server/interfaces/api/importListInterfaces';
import axios from 'axios';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages(
  'components.UserProfile.UserSettings.UserImportListsSettings',
  {
    addList: 'Add List',
    addListTitle: 'Add Import List',
    provider: 'Provider',
    listIdentifier: 'List',
    listIdentifierTip:
      'Paste the list URL, or use the short form the provider accepts.',
    displayName: 'Display Name',
    displayNameTip: 'Leave blank to use the name from the list itself.',
    mode: 'On Sync',
    modeRequest: 'Request the items',
    modeWatchlist: 'Add to my watchlist',
    request4k: 'Request in 4K',
    bookFormat: 'Book Format',
    formatEbook: 'Ebook',
    formatAudiobook: 'Audiobook',
    formatBoth: 'Both',
    save: 'Add List',
    saving: 'Adding…',
    cancel: 'Cancel',
    addSuccess: 'Import list added.',
    addFailed: 'Could not add that import list.',
    providerNeedsCredentials:
      'This provider needs credentials that an administrator has not configured yet.',
  }
);

type AddImportListModalProps = {
  userId: number;
  providers: ImportListProviderInfo[];
  bookshelfConfigured: boolean;
  onCancel: () => void;
  onCreated: (list: ImportListResponse) => void;
};

const AddImportListModal = ({
  userId,
  providers,
  bookshelfConfigured,
  onCancel,
  onCreated,
}: AddImportListModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  // A provider needing an unset credential, or books with no Bookshelf, cannot
  // produce a working list — so it is offered but explains itself rather than
  // failing at the first sync.
  const selectable = useMemo(
    () =>
      providers.filter(
        (provider) => !provider.requiresBookshelf || bookshelfConfigured
      ),
    [providers, bookshelfConfigured]
  );

  const [provider, setProvider] = useState<ImportListProviderId | ''>(
    selectable[0]?.id ?? ''
  );
  const [listId, setListId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ImportListMode>(ImportListMode.REQUEST);
  const [is4k, setIs4k] = useState(false);
  const [bookFormat, setBookFormat] = useState<ImportListBookFormat>(
    ImportListBookFormat.EBOOK
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = selectable.find((entry) => entry.id === provider);
  const isBookProvider = selectedProvider?.requiresBookshelf ?? false;

  const submit = async () => {
    if (!provider || !listId.trim()) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await axios.post<ImportListResponse>(
        `/api/v1/user/${userId}/importlists`,
        {
          provider,
          listId: listId.trim(),
          name: name.trim() || undefined,
          mode,
          is4k,
          ...(isBookProvider ? { bookFormat } : {}),
        }
      );

      addToast(intl.formatMessage(messages.addSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      onCreated(response.data);
    } catch (e) {
      // The server explains exactly which identifier form it wanted, so show
      // that rather than a generic failure.
      const message =
        (axios.isAxiosError(e) &&
          (e.response?.data as { message?: string } | undefined)?.message) ||
        intl.formatMessage(messages.addFailed);
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Modal
        title={intl.formatMessage(messages.addListTitle)}
        onCancel={onCancel}
        onOk={submit}
        okText={intl.formatMessage(isSaving ? messages.saving : messages.save)}
        okDisabled={isSaving || !provider || !listId.trim()}
        cancelText={intl.formatMessage(messages.cancel)}
      >
        <div className="mb-6">
          {error && (
            <div className="mb-4 rounded-md bg-red-600/20 p-3 text-sm text-red-100 ring-1 ring-red-500">
              {error}
            </div>
          )}

          <div className="form-row">
            <label htmlFor="provider" className="text-label">
              {intl.formatMessage(messages.provider)}
            </label>
            <div className="form-input-area">
              <select
                id="provider"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as ImportListProviderId);
                  setError(null);
                }}
              >
                {selectable.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              {selectedProvider && !selectedProvider.configured && (
                <div className="error">
                  {intl.formatMessage(messages.providerNeedsCredentials)}
                </div>
              )}
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="listId" className="text-label">
              {intl.formatMessage(messages.listIdentifier)}
              <span className="label-tip">
                {intl.formatMessage(messages.listIdentifierTip)}
              </span>
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <input
                  id="listId"
                  type="text"
                  value={listId}
                  placeholder={selectedProvider?.example}
                  onChange={(e) => {
                    setListId(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="name" className="text-label">
              {intl.formatMessage(messages.displayName)}
              <span className="label-tip">
                {intl.formatMessage(messages.displayNameTip)}
              </span>
            </label>
            <div className="form-input-area">
              <div className="form-input-field">
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="mode" className="text-label">
              {intl.formatMessage(messages.mode)}
            </label>
            <div className="form-input-area">
              <select
                id="mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as ImportListMode)}
              >
                <option value={ImportListMode.REQUEST}>
                  {intl.formatMessage(messages.modeRequest)}
                </option>
                <option value={ImportListMode.WATCHLIST}>
                  {intl.formatMessage(messages.modeWatchlist)}
                </option>
              </select>
            </div>
          </div>

          {isBookProvider ? (
            <div className="form-row">
              <label htmlFor="bookFormat" className="text-label">
                {intl.formatMessage(messages.bookFormat)}
              </label>
              <div className="form-input-area">
                <select
                  id="bookFormat"
                  value={bookFormat}
                  onChange={(e) =>
                    setBookFormat(e.target.value as ImportListBookFormat)
                  }
                >
                  <option value={ImportListBookFormat.EBOOK}>
                    {intl.formatMessage(messages.formatEbook)}
                  </option>
                  <option value={ImportListBookFormat.AUDIOBOOK}>
                    {intl.formatMessage(messages.formatAudiobook)}
                  </option>
                  <option value={ImportListBookFormat.BOTH}>
                    {intl.formatMessage(messages.formatBoth)}
                  </option>
                </select>
              </div>
            </div>
          ) : (
            <div className="form-row">
              <label htmlFor="is4k" className="checkbox-label">
                {intl.formatMessage(messages.request4k)}
              </label>
              <div className="form-input-area">
                <input
                  id="is4k"
                  type="checkbox"
                  checked={is4k}
                  onChange={() => setIs4k(!is4k)}
                />
              </div>
            </div>
          )}
        </div>
      </Modal>
    </Transition>
  );
};

export default AddImportListModal;
