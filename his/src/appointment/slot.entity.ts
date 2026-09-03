import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Doctor } from './doctor.entity';

@Entity()
export class Slot {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Doctor)
  @JoinColumn({ name: 'doctorId' })
  doctor: Doctor;

  @Column()
  doctorId: number;

  @Column({ type: 'date' })
  date: string;

  @Column()
  time: string;

  @Column()
  timeOfDay: string;

  @Column({ default: false })
  taken: boolean;

  @Column({ type: 'int', nullable: true })
  patientId: number | null;
}
