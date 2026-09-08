import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImportLists1784300000000 implements MigrationInterface {
  name = 'AddImportLists1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "import_list" ("id" SERIAL NOT NULL, "userId" integer, "provider" character varying(32) NOT NULL, "listId" character varying(512) NOT NULL, "name" character varying(255) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "mode" character varying(16) NOT NULL, "is4k" boolean NOT NULL DEFAULT false, "bookFormat" character varying(16), "lastSyncedAt" TIMESTAMP WITH TIME ZONE, "lastSyncStatus" character varying(16) NOT NULL DEFAULT 'never', "lastSyncError" character varying(512), "itemCount" integer NOT NULL DEFAULT 0, "lastRequestedCount" integer NOT NULL DEFAULT 0, "lastSkippedCount" integer NOT NULL DEFAULT 0, "lastErrorCount" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_import_list_user_provider_list" UNIQUE ("userId", "provider", "listId"), CONSTRAINT "PK_import_list" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `ALTER TABLE "import_list" ADD CONSTRAINT "FK_import_list_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_import_list_user" ON "import_list" ("userId")`
    );
    await queryRunner.query(
      `CREATE TABLE "import_list_item" ("id" SERIAL NOT NULL, "importListId" integer, "mediaType" character varying(16) NOT NULL, "tmdbId" integer, "externalId" character varying(64), "title" character varying(255) NOT NULL, "year" integer, "status" character varying(32) NOT NULL, "message" character varying(512), "processedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_import_list_item_tmdb" UNIQUE ("importListId", "mediaType", "tmdbId"), CONSTRAINT "UQ_import_list_item_external" UNIQUE ("importListId", "mediaType", "externalId"), CONSTRAINT "PK_import_list_item" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `ALTER TABLE "import_list_item" ADD CONSTRAINT "FK_import_list_item_list" FOREIGN KEY ("importListId") REFERENCES "import_list" ("id") ON DELETE CASCADE ON UPDATE NO ACTION`
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
    await queryRunner.query(
      `ALTER TABLE "import_list_item" DROP CONSTRAINT "FK_import_list_item_list"`
    );
    await queryRunner.query(`DROP TABLE "import_list_item"`);
    await queryRunner.query(`DROP INDEX "IDX_import_list_user"`);
    await queryRunner.query(
      `ALTER TABLE "import_list" DROP CONSTRAINT "FK_import_list_user"`
    );
    await queryRunner.query(`DROP TABLE "import_list"`);
  }
}
