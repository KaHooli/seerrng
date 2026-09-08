import UserSettings from '@app/components/UserProfile/UserSettings';
import UserImportListsSettings from '@app/components/UserProfile/UserSettings/UserImportListsSettings';
import type { NextPage } from 'next';

const UserSettingsImportListsPage: NextPage = () => {
  return (
    <UserSettings>
      <UserImportListsSettings />
    </UserSettings>
  );
};

export default UserSettingsImportListsPage;
