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

  async findAvailableDays(specialty: string, timeOfDay: string): Promise<string[]> {
    const rows = await this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('doctor.specialty = :specialty', { specialty })
      .andWhere('slot.timeOfDay = :timeOfDay', { timeOfDay })
      .andWhere('slot.taken = false')
      .select('slot.date::text', 'date')
      .distinct(true)
      .orderBy('slot.date::text', 'ASC')
      .limit(3)
      .getRawMany<{ date: string }>();
    return rows.map((row) => row.date);
  }

  async findAvailableTimes(specialty: string, timeOfDay: string, date: string): Promise<string[]> {
    const rows = await this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('doctor.specialty = :specialty', { specialty })
      .andWhere('slot.timeOfDay = :timeOfDay', { timeOfDay })
      .andWhere('slot.date = :date', { date })
      .andWhere('slot.taken = false')
      .select('slot.time', 'time')
      .distinct(true)
      .orderBy('slot.time', 'ASC')
      .limit(3)
      .getRawMany<{ time: string }>();
    return rows.map((row) => row.time);
  }

  async findAppointmentsForPatient(patientId: number): Promise<{ specialty: string; date: string; time: string }[]> {
    return this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('slot.patientId = :patientId', { patientId })
      .andWhere('slot.taken = true')
      .andWhere('slot.date >= CURRENT_DATE')
      .select('doctor.specialty', 'specialty')
      .addSelect('slot.date::text', 'date')
      .addSelect('slot.time', 'time')
      .orderBy('slot.date::text', 'ASC')
      .addOrderBy('slot.time', 'ASC')
      .limit(4)
      .getRawMany<{ specialty: string; date: string; time: string }>();
  }

  async book(specialty: string, timeOfDay: string, date: string, time: string, patientId: number): Promise<boolean> {
    const candidate = await this.slotRepository
      .createQueryBuilder('slot')
      .innerJoin('slot.doctor', 'doctor')
      .where('doctor.specialty = :specialty', { specialty })
      .andWhere('slot.timeOfDay = :timeOfDay', { timeOfDay })
      .andWhere('slot.date = :date', { date })
      .andWhere('slot.time = :time', { time })
      .andWhere('slot.taken = false')
      .getOne();
    if (!candidate) return false;

    const result = await this.slotRepository.update({ id: candidate.id, taken: false }, { taken: true, patientId });
    return (result.affected ?? 0) > 0;
  }
}
