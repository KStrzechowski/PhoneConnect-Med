import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Patient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  pesel: string;

  @Column()
  phone: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;
}
