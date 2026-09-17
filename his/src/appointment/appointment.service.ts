import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Slot } from './slot.entity';

@Injectable()
export class AppointmentService {
  constructor(
    @InjectRepository(Slot)
    private readonly slotRepository: Repository<Slot>,
  ) {}

  async findAvailableDays(
    specialty: string,
    timeOfDay: string,
  ): Promise<string[]> {
    const rows = await this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('doctor.specialty = :specialty', { specialty })
      .andWhere('slot.timeOfDay = :timeOfDay', { timeOfDay })
      .andWhere('slot.taken = false')
      .andWhere("slot.date >= (now() AT TIME ZONE 'Europe/Warsaw')::date")
      .select('slot.date::text', 'date')
      .distinct(true)
      .orderBy('slot.date::text', 'ASC')
      .limit(3)
      .getRawMany<{ date: string }>();
    return rows.map((row) => row.date);
  }

  async findAvailableTimes(
    specialty: string,
    timeOfDay: string | undefined,
    date: string,
    minTime?: string,
    maxTime?: string,
  ): Promise<string[]> {
    const query = this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('doctor.specialty = :specialty', { specialty })
      .andWhere('slot.date = :date', { date })
      .andWhere('slot.taken = false');
    if (timeOfDay) query.andWhere('slot.timeOfDay = :timeOfDay', { timeOfDay });
    // minTime/maxTime must be applied here, in the query, not by the caller filtering the
    // result afterward — a caller-side filter would run on whatever survives the limit(3) below,
    // silently dropping a real match that just wasn't among the day's 3 earliest times.
    if (minTime) query.andWhere('slot.time >= :minTime', { minTime });
    if (maxTime) query.andWhere('slot.time <= :maxTime', { maxTime });
    const rows = await query
      .select('slot.time', 'time')
      .distinct(true)
      .orderBy('slot.time', 'ASC')
      .limit(3)
      .getRawMany<{ time: string }>();
    return rows.map((row) => row.time);
  }

  async findNearestAvailable(
    specialty: string,
    minTime?: string,
    maxTime?: string,
    minDate?: string,
  ): Promise<{ date: string; time: string } | null> {
    const query = this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('doctor.specialty = :specialty', { specialty })
      .andWhere('slot.taken = false')
      .andWhere("slot.date >= (now() AT TIME ZONE 'Europe/Warsaw')::date");
    if (minTime) query.andWhere('slot.time >= :minTime', { minTime });
    if (maxTime) query.andWhere('slot.time <= :maxTime', { maxTime });
    if (minDate) query.andWhere('slot.date >= :minDate', { minDate });
    const row = await query
      .select('slot.date::text', 'date')
      .addSelect('slot.time', 'time')
      .orderBy('slot.date::text', 'ASC')
      .addOrderBy('slot.time', 'ASC')
      .limit(1)
      .getRawOne<{ date: string; time: string }>();
    return row ?? null;
  }

  async findAppointmentsForPatient(
    patientId: number,
  ): Promise<{ specialty: string; date: string; time: string }[]> {
    return this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('slot.patientId = :patientId', { patientId })
      .andWhere('slot.taken = true')
      .andWhere("slot.date >= (now() AT TIME ZONE 'Europe/Warsaw')::date")
      .select('doctor.specialty', 'specialty')
      .addSelect('slot.date::text', 'date')
      .addSelect('slot.time', 'time')
      .orderBy('slot.date::text', 'ASC')
      .addOrderBy('slot.time', 'ASC')
      .limit(4)
      .getRawMany<{ specialty: string; date: string; time: string }>();
  }

  async book(
    specialty: string,
    timeOfDay: string | undefined,
    date: string,
    time: string,
    patientId: number,
  ): Promise<boolean> {
    const query = this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('doctor.specialty = :specialty', { specialty })
      .andWhere('slot.date = :date', { date })
      .andWhere('slot.time = :time', { time })
      .andWhere('slot.taken = false');
    if (timeOfDay) query.andWhere('slot.timeOfDay = :timeOfDay', { timeOfDay });
    const candidate = await query.getOne();
    if (!candidate) return false;

    const result = await this.slotRepository.update(
      { id: candidate.id, taken: false },
      { taken: true, patientId },
    );
    return (result.affected ?? 0) > 0;
  }

  async cancel(
    date: string,
    time: string,
    patientId: number,
  ): Promise<boolean> {
    const candidate = await this.slotRepository.findOne({
      where: { date, time, patientId, taken: true },
    });
    if (!candidate) return false;

    const result = await this.slotRepository.update(
      { id: candidate.id, taken: true },
      { taken: false, patientId: null },
    );
    return (result.affected ?? 0) > 0;
  }
}
