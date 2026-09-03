import { MigrationInterface, QueryRunner } from 'typeorm';

const specialties = [
  'kardiolog',
  'dermatolog',
  'okulista',
  'laryngolog',
  'neurolog',
  'ortopeda',
  'internista',
  'ginekolog',
  'pediatra',
  'endokrynolog',
  'chirurg',
  'urolog',
  'psychiatra',
  'alergolog',
];
// 'reumatolog' is deliberately not seeded — the no-doctor-for-this-specialty edge case.

const fullyBookedSpecialty = 'alergolog';
// Has a doctor, but every generated slot below is pre-taken — the no-free-slot edge case,
// distinct from the no-doctor case above.

const doctorNames: [string, string][] = [
  ['Piotr', 'Zieliński'],
  ['Ewa', 'Nowak'],
  ['Marek', 'Wójcik'],
  ['Agnieszka', 'Kaczmarek'],
  ['Tomasz', 'Lewandowski'],
  ['Katarzyna', 'Dąbrowska'],
  ['Michał', 'Kowalczyk'],
  ['Magdalena', 'Wiśniewska'],
  ['Paweł', 'Wojciechowski'],
  ['Joanna', 'Krawczyk'],
  ['Grzegorz', 'Kamiński'],
  ['Anna', 'Piotrowska'],
  ['Adam', 'Grabowski'],
  ['Maria', 'Szymańska'],
];

const timeOfDaySlots: Record<string, string[]> = {
  rano: ['08:00', '09:30'],
  'przed południem': ['11:00', '12:00'],
  'po południu': ['13:30', '15:00'],
  wieczorem: ['17:00', '18:30'],
};

const forwardWeekdays = (count: number): string[] => {
  const dates: string[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() + 1);
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

export class CreateAppointment1788469015011 implements MigrationInterface {
  name = 'CreateAppointment1788469015011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "doctor" (
        "id" SERIAL NOT NULL,
        "specialty" character varying NOT NULL,
        "firstName" character varying NOT NULL,
        "lastName" character varying NOT NULL,
        CONSTRAINT "PK_doctor_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "slot" (
        "id" SERIAL NOT NULL,
        "doctorId" integer NOT NULL,
        "date" date NOT NULL,
        "time" character varying NOT NULL,
        "timeOfDay" character varying NOT NULL,
        "taken" boolean NOT NULL DEFAULT false,
        "patientId" integer,
        CONSTRAINT "PK_slot_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_slot_doctor" FOREIGN KEY ("doctorId") REFERENCES "doctor"("id")
      )
    `);

    const weekdays = forwardWeekdays(10);

    for (let i = 0; i < specialties.length; i++) {
      const specialty = specialties[i];
      const [firstName, lastName] = doctorNames[i];
      const [{ id: doctorId }] = await queryRunner.query(
        `INSERT INTO "doctor" ("specialty", "firstName", "lastName") VALUES ($1, $2, $3) RETURNING "id"`,
        [specialty, firstName, lastName],
      );
      const preBooked = specialty === fullyBookedSpecialty;

      for (const date of weekdays) {
        for (const [timeOfDay, times] of Object.entries(timeOfDaySlots)) {
          for (const time of times) {
            await queryRunner.query(
              `INSERT INTO "slot" ("doctorId", "date", "time", "timeOfDay", "taken") VALUES ($1, $2, $3, $4, $5)`,
              [doctorId, date, time, timeOfDay, preBooked],
            );
          }
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "slot"`);
    await queryRunner.query(`DROP TABLE "doctor"`);
  }
}
