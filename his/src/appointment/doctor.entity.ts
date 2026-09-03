import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Doctor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  specialty: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;
}
