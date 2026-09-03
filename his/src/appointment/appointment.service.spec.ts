import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '../data-source';
import { AppointmentModule } from './appointment.module';
import { AppointmentService } from './appointment.service';

describe('AppointmentService', () => {
  let module: TestingModule;
  let service: AppointmentService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(dataSourceOptions), AppointmentModule],
    }).compile();

    service = module.get<AppointmentService>(AppointmentService);
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
});
