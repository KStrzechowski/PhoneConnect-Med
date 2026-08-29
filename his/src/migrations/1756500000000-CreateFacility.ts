import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFacility1756500000000 implements MigrationInterface {
  name = 'CreateFacility1756500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "facility" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "address" character varying NOT NULL,
        "opensAt" character varying NOT NULL,
        "closesAt" character varying NOT NULL,
        "openDays" character varying NOT NULL,
        CONSTRAINT "PK_facility_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "facility" ("name", "address", "opensAt", "closesAt", "openDays")
      VALUES ('Przychodnia Zdrowie', 'ul. Kwiatowa 12, 00-001 Warszawa', '08:00', '18:00', 'monday-friday')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "facility"`);
  }
}
