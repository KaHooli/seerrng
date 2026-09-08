import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImportLists1784300000000 implements MigrationInterface {
  name = 'AddImportLists1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "import_list" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer, "provider" varchar(32) NOT NULL, "listId" varchar(512) NOT NULL, "name" varchar(255) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "mode" varchar(16) NOT NULL, "is4k" boolean NOT NULL DEFAULT (0), "bookFormat" varchar(16), "lastSyncedAt" datetime, "lastSyncStatus" varchar(16) NOT NULL DEFAULT ('never'), "lastSyncError" varchar(512), "itemCount" integer NOT NULL DEFAULT (0), "lastRequestedCount" integer NOT NULL DEFAULT (0), "lastSkippedCount" integer NOT NULL DEFAULT (0), "lastErrorCount" integer NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_import_list_user_provider_list" UNIQUE ("userId", "provider", "listId"), CONSTRAINT "FK_import_list_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_import_list_user" ON "import_list" ("userId")`
    );
    await queryRunner.query(
      `CREATE TABLE "import_list_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "importListId" integer, "mediaType" varchar(16) NOT NULL, "tmdbId" integer, "externalId" varchar(64), "title" varchar(255) NOT NULL, "year" integer, "status" varchar(32) NOT NULL, "message" varchar(512), "processedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_import_list_item_tmdb" UNIQUE ("importListId", "mediaType", "tmdbId"), CONSTRAINT "UQ_import_list_item_external" UNIQUE ("importListId", "mediaType", "externalId"), CONSTRAINT "FK_import_list_item_list" FOREIGN KEY ("importListId") REFERENCES "import_list" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_import_list_item_list" ON "import_list_item" ("importListId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_import_list_item_status" ON "import_list_item" ("status")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_import_list_item_status"`);
    await queryRunner.query(`DROP INDEX "IDX_import_list_item_list"`);
    await queryRunner.query(`DROP TABLE "import_list_item"`);
    await queryRunner.query(`DROP INDEX "IDX_import_list_user"`);
    await queryRunner.query(`DROP TABLE "import_list"`);
  }
}
