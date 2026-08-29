import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Facility {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  address: string;

  @Column()
  opensAt: string;

  @Column()
  closesAt: string;

  @Column()
  openDays: string;
}
