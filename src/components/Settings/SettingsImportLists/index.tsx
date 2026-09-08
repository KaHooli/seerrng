import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon, BeakerIcon } from '@heroicons/react/24/outline';
import type { ImportListSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.SettingsImportLists', {
  importLists: 'Import Lists',
  importListsSettings: 'Import List Settings',
  importListsSettingsDescription:
    'Configure how users’ import lists are synced, and supply the API credentials the list providers need.',
  enabled: 'Enable Import List Syncing',
  enabledTip: 'When disabled, the sync job still runs but processes no lists.',
  syncSchedule: 'Sync Frequency',
  syncScheduleTip:
    'Set under Settings → Jobs & Cache, where the Import List Sync job can also be run on demand.',
  goToJobs: 'Open Jobs & Cache',
  maxItemsPerList: 'Maximum Items Per List',
  maxItemsPerListTip:
    'Upper bound on how many items are read from a single list, per sync.',
  syncConcurrency: 'Sync Concurrency',
  syncConcurrencyTip: 'How many lists are fetched at once, across all users.',
  defaultMode: 'Default Action For New Lists',
  modeRequest: 'Request the items',
  modeWatchlist: 'Add to the owner’s watchlist',
  credentials: 'Provider Credentials',
  traktClientId: 'Trakt Client ID',
  traktClientIdTip: 'Required before any Trakt list can sync.',
  tvdbApiKey: 'TVDB API Key',
  tvdbApiKeyTip: 'Optional. Improves TVDB list reliability.',
  mdblistApiKey: 'MDBList API Key',
  mdblistApiKeyTip: 'Optional. Public MDBList lists work without one.',
  test: 'Test',
  testing: 'Testing…',
  traktTestSuccess: 'Trakt accepted that client ID.',
  traktTestFailed: 'Trakt rejected that client ID.',
  toastSettingsSuccess: 'Import list settings saved successfully!',
  toastSettingsFailure: 'Something went wrong while saving settings.',
  validationMaxItems: 'You must provide a value between 1 and 5000',
  validationConcurrency: 'You must provide a value between 1 and 10',
});

const SettingsImportLists = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [isTestingTrakt, setIsTestingTrakt] = useState(false);

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<ImportListSettings>('/api/v1/settings/importlists');

  const ImportListSettingsSchema = Yup.object().shape({
    maxItemsPerList: Yup.number()
      .min(1, intl.formatMessage(messages.validationMaxItems))
      .max(5000, intl.formatMessage(messages.validationMaxItems))
      .required(intl.formatMessage(messages.validationMaxItems)),
    syncConcurrency: Yup.number()
      .min(1, intl.formatMessage(messages.validationConcurrency))
      .max(10, intl.formatMessage(messages.validationConcurrency))
      .required(intl.formatMessage(messages.validationConcurrency)),
  });

  const testTrakt = async (traktClientId: string) => {
    setIsTestingTrakt(true);
    try {
      await axios.post('/api/v1/settings/importlists/test/trakt', {
        traktClientId,
      });
      addToast(intl.formatMessage(messages.traktTestSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch {
      addToast(intl.formatMessage(messages.traktTestFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsTestingTrakt(false);
    }
  };

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.importLists),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.importListsSettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.importListsSettingsDescription)}
        </p>
      </div>
      <div className="section">
        <Formik
          initialValues={{
            enabled: data?.enabled ?? true,
            maxItemsPerList: data?.maxItemsPerList ?? 500,
            syncConcurrency: data?.syncConcurrency ?? 2,
            defaultMode: data?.defaultMode ?? 'request',
            traktClientId: data?.traktClientId ?? '',
            tvdbApiKey: data?.tvdbApiKey ?? '',
            mdblistApiKey: data?.mdblistApiKey ?? '',
          }}
          enableReinitialize
          validationSchema={ImportListSettingsSchema}
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/importlists', {
                enabled: values.enabled,
                maxItemsPerList: Number(values.maxItemsPerList),
                syncConcurrency: Number(values.syncConcurrency),
                defaultMode: values.defaultMode,
                traktClientId: values.traktClientId,
                tvdbApiKey: values.tvdbApiKey,
                mdblistApiKey: values.mdblistApiKey,
              });

              addToast(intl.formatMessage(messages.toastSettingsSuccess), {
                appearance: 'success',
                autoDismiss: true,
              });
            } catch {
              addToast(intl.formatMessage(messages.toastSettingsFailure), {
                appearance: 'error',
                autoDismiss: true,
              });
            } finally {
              revalidate();
            }
          }}
        >
          {({ errors, touched, values, isSubmitting, isValid }) => (
            <Form className="section" data-testid="settings-importlists-form">
              <div className="form-row">
                <label htmlFor="enabled" className="checkbox-label">
                  {intl.formatMessage(messages.enabled)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.enabledTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <Field type="checkbox" id="enabled" name="enabled" />
                </div>
              </div>

              <div className="form-row">
                <span className="text-label">
                  {intl.formatMessage(messages.syncSchedule)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.syncScheduleTip)}
                  </span>
                </span>
                <div className="form-input-area">
                  <Button
                    as="a"
                    href="/settings/jobs"
                    buttonType="ghost"
                    type="button"
                  >
                    <span>{intl.formatMessage(messages.goToJobs)}</span>
                  </Button>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="maxItemsPerList" className="text-label">
                  {intl.formatMessage(messages.maxItemsPerList)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.maxItemsPerListTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="maxItemsPerList"
                      name="maxItemsPerList"
                      type="number"
                      min="1"
                      max="5000"
                    />
                  </div>
                  {errors.maxItemsPerList &&
                    touched.maxItemsPerList &&
                    typeof errors.maxItemsPerList === 'string' && (
                      <div className="error">{errors.maxItemsPerList}</div>
                    )}
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="syncConcurrency" className="text-label">
                  {intl.formatMessage(messages.syncConcurrency)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.syncConcurrencyTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      id="syncConcurrency"
                      name="syncConcurrency"
                      type="number"
                      min="1"
                      max="10"
                    />
                  </div>
                  {errors.syncConcurrency &&
                    touched.syncConcurrency &&
                    typeof errors.syncConcurrency === 'string' && (
                      <div className="error">{errors.syncConcurrency}</div>
                    )}
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="defaultMode" className="text-label">
                  {intl.formatMessage(messages.defaultMode)}
                </label>
                <div className="form-input-area">
                  <Field as="select" id="defaultMode" name="defaultMode">
                    <option value="request">
                      {intl.formatMessage(messages.modeRequest)}
                    </option>
                    <option value="watchlist">
                      {intl.formatMessage(messages.modeWatchlist)}
                    </option>
                  </Field>
                </div>
              </div>

              <div className="mt-10">
                <h3 className="heading">
                  {intl.formatMessage(messages.credentials)}
                </h3>
              </div>

              <div className="form-row">
                <label htmlFor="traktClientId" className="text-label">
                  {intl.formatMessage(messages.traktClientId)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.traktClientIdTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="traktClientId"
                      name="traktClientId"
                      type="text"
                    />
                  </div>
                  <div className="mt-2">
                    <Button
                      buttonType="ghost"
                      type="button"
                      disabled={isTestingTrakt || !values.traktClientId}
                      onClick={() => testTrakt(values.traktClientId)}
                    >
                      <BeakerIcon />
                      <span>
                        {intl.formatMessage(
                          isTestingTrakt ? messages.testing : messages.test
                        )}
                      </span>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="tvdbApiKey" className="text-label">
                  {intl.formatMessage(messages.tvdbApiKey)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.tvdbApiKeyTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="tvdbApiKey"
                      name="tvdbApiKey"
                      type="text"
                    />
                  </div>
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="mdblistApiKey" className="text-label">
                  {intl.formatMessage(messages.mdblistApiKey)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.mdblistApiKeyTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="mdblistApiKey"
                      name="mdblistApiKey"
                      type="text"
                    />
                  </div>
                </div>
              </div>

              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={isSubmitting || !isValid}
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {intl.formatMessage(
                          isSubmitting
                            ? globalMessages.saving
                            : globalMessages.save
                        )}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </>
  );
};

export default SettingsImportLists;
