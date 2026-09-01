import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePatient1788225506354 implements MigrationInterface {
  name = 'CreatePatient1788225506354';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "patient" (
        "id" SERIAL NOT NULL,
        "pesel" character varying NOT NULL,
        "phone" character varying NOT NULL,
        "firstName" character varying NOT NULL,
        "lastName" character varying NOT NULL,
        CONSTRAINT "PK_patient_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "patient" ("pesel", "phone", "firstName", "lastName")
      VALUES ('90010112345', '+48000000000', 'Jan', 'Kowalski')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "patient"`);
  }
}
