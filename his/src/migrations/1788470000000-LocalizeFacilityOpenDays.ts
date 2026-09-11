import { MigrationInterface, QueryRunner } from 'typeorm';

export class LocalizeFacilityOpenDays1788470000000 implements MigrationInterface {
  name = 'LocalizeFacilityOpenDays1788470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "facility" SET "openDays" = 'poniedziałek-piątek' WHERE "openDays" = 'monday-friday'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "facility" SET "openDays" = 'monday-friday' WHERE "openDays" = 'poniedziałek-piątek'
    `);
  }
}
