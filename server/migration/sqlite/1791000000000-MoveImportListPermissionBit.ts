import type { MigrationInterface, QueryRunner } from 'typeorm';

// MANAGE_IMPORT_LISTS was first shipped by this fork as 2^37. Upstream later
// assigned 2^37 to AUTO_APPROVE_COMIC, so the fork moved its permission to
// 2^52. A grant of 2^37 means "manage import lists" only when this database
// recorded the fork's import-list migration before upstream's comic
// migrations; a database that came from upstream already uses 2^37 for comics
// and is left alone.
const LEGACY_IMPORT_LIST_BIT = 137438953472;
const IMPORT_LIST_BIT = 4503599627370496;
const IMPORT_LIST_MIGRATION = 'AddImportLists1784300000000';
const COMIC_MIGRATION = 'AddComicServiceType1790306190792';

export class MoveImportListPermissionBit1791000000000 implements MigrationInterface {
  name = 'MoveImportListPermissionBit1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: number | string; name: string }[] =
      await queryRunner.query(
        `SELECT "id", "name" FROM "migrations" WHERE "name" IN ('${IMPORT_LIST_MIGRATION}', '${COMIC_MIGRATION}')`
      );
    const idOf = (name: string): number | undefined => {
      const row = rows.find((candidate) => candidate.name === name);
      return row === undefined ? undefined : Number(row.id);
    };
    const importListId = idOf(IMPORT_LIST_MIGRATION);
    const comicId = idOf(COMIC_MIGRATION);

    if (
      importListId === undefined ||
      (comicId !== undefined && comicId < importListId)
    ) {
      return;
    }

    await queryRunner.query(
      `UPDATE "user" SET "permissions" = "permissions" - ${LEGACY_IMPORT_LIST_BIT} + ${IMPORT_LIST_BIT} WHERE ("permissions" & ${LEGACY_IMPORT_LIST_BIT}) <> 0 AND ("permissions" & ${IMPORT_LIST_BIT}) = 0`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "user" SET "permissions" = "permissions" - ${IMPORT_LIST_BIT} + ${LEGACY_IMPORT_LIST_BIT} WHERE ("permissions" & ${IMPORT_LIST_BIT}) <> 0 AND ("permissions" & ${LEGACY_IMPORT_LIST_BIT}) = 0`
    );
  }
}
