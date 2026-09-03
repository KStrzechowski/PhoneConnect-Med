import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtpFallbackToPatient1788461728029 implements MigrationInterface {
  name = 'AddOtpFallbackToPatient1788461728029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patient"
      ADD COLUMN "isDemo" boolean NOT NULL DEFAULT false,
      ADD COLUMN "demoOtpCode" character varying
    `);
    // Demo pair for testers who can't receive a texted code: pesel 85050512345 / phone
    // +48999999999, fixed OTP 123456.
    await queryRunner.query(`
      INSERT INTO "patient" ("pesel", "phone", "firstName", "lastName", "isDemo", "demoOtpCode")
      VALUES ('85050512345', '+48999999999', 'Anna', 'Demo', true, '123456')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "patient" WHERE "isDemo" = true`);
    await queryRunner.query(`
      ALTER TABLE "patient"
      DROP COLUMN "isDemo",
      DROP COLUMN "demoOtpCode"
    `);
  }
}
