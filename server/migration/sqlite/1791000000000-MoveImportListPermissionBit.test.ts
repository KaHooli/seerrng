import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { MoveImportListPermissionBit1791000000000 } from './1791000000000-MoveImportListPermissionBit';

const LEGACY_BIT = 137438953472;
const NEW_BIT = 4503599627370496;
const REQUEST = 32;

const migrateWith = async (appliedInOrder: string[]): Promise<number> => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(
      `CREATE TABLE "migrations" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)`
    );
    for (const name of appliedInOrder) {
      await queryRunner.query(
        `INSERT INTO "migrations" ("timestamp", "name") VALUES (0, ?)`,
        [name]
      );
    }
    await queryRunner.query(
      `CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "permissions" integer NOT NULL DEFAULT (0))`
    );
    await queryRunner.query(`INSERT INTO "user" ("permissions") VALUES (?)`, [
      REQUEST + LEGACY_BIT,
    ]);

    await new MoveImportListPermissionBit1791000000000().up(queryRunner);

    const [row] = await queryRunner.query(`SELECT "permissions" FROM "user"`);
    return Number(row.permissions);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
};

test('moves the import-list grant on a database that ran the fork first', async () => {
  assert.equal(
    await migrateWith([
      'AddImportLists1784300000000',
      'AddComicServiceType1790306190792',
    ]),
    REQUEST + NEW_BIT
  );
});

test('leaves comic auto-approve alone on a database that came from upstream', async () => {
  assert.equal(
    await migrateWith([
      'AddComicServiceType1790306190792',
      'AddImportLists1784300000000',
    ]),
    REQUEST + LEGACY_BIT
  );
});
