import UserSettings from '@app/components/UserProfile/UserSettings';
import UserImportListsSettings from '@app/components/UserProfile/UserSettings/UserImportListsSettings';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const UserImportListsPage: NextPage = () => {
  useRouteGuard(Permission.MANAGE_IMPORT_LISTS);
  return (
    <UserSettings>
      <UserImportListsSettings />
    </UserSettings>
  );
};

export default UserImportListsPage;
