import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';
import { AppointmentModule } from './appointment.module';
import { AppointmentService } from './appointment.service';

describe('AppointmentService', () => {
  let module: TestingModule;
  let service: AppointmentService;
  let dataSource: DataSource;

  const releasePatientSlots = (patientId: number) =>
    dataSource.query(`UPDATE slot SET taken = false, "patientId" = NULL WHERE "patientId" = $1`, [patientId]);

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(dataSourceOptions), AppointmentModule],
    }).compile();

    service = module.get<AppointmentService>(AppointmentService);
    dataSource = module.get(DataSource);
  });

  afterAll(() => module.close());

  it('returns up to three available days for a seeded specialty and time of day', async () => {
    const days = await service.findAvailableDays('kardiolog', 'rano');

    expect(days.length).toBeGreaterThan(0);
    expect(days.length).toBeLessThanOrEqual(3);
    expect([...days].sort()).toEqual(days);
    for (const day of days) expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns available times on a chosen day', async () => {
    const [date] = await service.findAvailableDays('dermatolog', 'po południu');

    const times = await service.findAvailableTimes('dermatolog', 'po południu', date);

    expect(times).toEqual(['13:30', '15:00']);
  });

  it('returns no days for a specialty with no doctor', async () => {
    const days = await service.findAvailableDays('reumatolog', 'rano');

    expect(days).toEqual([]);
  });

  it('returns no days for a specialty whose doctor has no free slots', async () => {
    const days = await service.findAvailableDays('alergolog', 'rano');

    expect(days).toEqual([]);
  });

  it('books a free slot and it stops appearing as available', async () => {
    const [date] = await service.findAvailableDays('okulista', 'wieczorem');
    const [time] = await service.findAvailableTimes('okulista', 'wieczorem', date);

    const booked = await service.book('okulista', 'wieczorem', date, time, 1);
    const remaining = await service.findAvailableTimes('okulista', 'wieczorem', date);

    expect(booked).toBe(true);
    expect(remaining).not.toContain(time);
  });

  it('fails to book a slot that is already taken', async () => {
    const [date] = await service.findAvailableDays('urolog', 'przed południem');
    const [time] = await service.findAvailableTimes('urolog', 'przed południem', date);
    await service.book('urolog', 'przed południem', date, time, 1);

    const bookedAgain = await service.book('urolog', 'przed południem', date, time, 1);

    expect(bookedAgain).toBe(false);
  });

  it('returns a patient upcoming booked appointment with specialty, date, and time', async () => {
    await releasePatientSlots(501);
    const [date] = await service.findAvailableDays('neurolog', 'rano');
    const [time] = await service.findAvailableTimes('neurolog', 'rano', date);
    await service.book('neurolog', 'rano', date, time, 501);

    const appointments = await service.findAppointmentsForPatient(501);

    expect(appointments).toEqual([{ specialty: 'neurolog', date, time }]);
  });

  it('returns an empty array for a patient with no bookings', async () => {
    const appointments = await service.findAppointmentsForPatient(999999);

    expect(appointments).toEqual([]);
  });

  it('orders multiple appointments chronologically and caps at four rows', async () => {
    const patientId = 502;
    await releasePatientSlots(patientId);
    const timesOfDay = ['rano', 'przed południem', 'po południu', 'wieczorem'];
    let date = '';
    for (const timeOfDay of timesOfDay) {
      [date] = await service.findAvailableDays('ortopeda', timeOfDay);
      const times = await service.findAvailableTimes('ortopeda', timeOfDay, date);
      for (const time of times) {
        await service.book('ortopeda', timeOfDay, date, time, patientId);
      }
    }

    const appointments = await service.findAppointmentsForPatient(patientId);

    expect(appointments.length).toBe(4);
    expect(appointments.map((a) => a.time)).toEqual(['08:00', '09:30', '11:00', '12:00']);
    expect(appointments.every((a) => a.specialty === 'ortopeda' && a.date === date)).toBe(true);
  });

  it('excludes a past-dated appointment even when taken', async () => {
    const patientId = 503;
    await dataSource.query(`DELETE FROM slot WHERE "patientId" = $1`, [patientId]);
    const [{ id: doctorId }] = await dataSource.query(
      `SELECT id FROM doctor WHERE specialty = $1 LIMIT 1`,
      ['endokrynolog'],
    );
    await dataSource.query(
      `INSERT INTO slot ("doctorId", date, time, "timeOfDay", taken, "patientId") VALUES ($1, CURRENT_DATE - INTERVAL '1 day', '10:00', 'rano', true, $2)`,
      [doctorId, patientId],
    );

    const appointments = await service.findAppointmentsForPatient(patientId);

    expect(appointments).toEqual([]);
  });
});
