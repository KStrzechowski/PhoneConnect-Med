import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Doctor } from './doctor.entity';
import { Slot } from './slot.entity';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';

@Module({
  imports: [TypeOrmModule.forFeature([Doctor, Slot])],
  controllers: [AppointmentController],
  providers: [AppointmentService],
})
export class AppointmentModule {}
