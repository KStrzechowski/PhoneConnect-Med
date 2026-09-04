import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AppointmentService } from './appointment.service';

@Controller('appointment')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Get('days')
  async days(@Query('specialty') specialty: string, @Query('timeOfDay') timeOfDay: string) {
    return { days: await this.appointmentService.findAvailableDays(specialty, timeOfDay) };
  }

  @Get('times')
  async times(
    @Query('specialty') specialty: string,
    @Query('timeOfDay') timeOfDay: string,
    @Query('date') date: string,
  ) {
    return { times: await this.appointmentService.findAvailableTimes(specialty, timeOfDay, date) };
  }

  @Get('mine')
  async mine(@Query('patientId') patientId: string) {
    return { appointments: await this.appointmentService.findAppointmentsForPatient(Number(patientId)) };
  }

  @Post('book')
  async book(
    @Body() body: { specialty: string; timeOfDay: string; date: string; time: string; patientId: number },
  ) {
    const booked = await this.appointmentService.book(
      body.specialty,
      body.timeOfDay,
      body.date,
      body.time,
      body.patientId,
    );
    return { booked };
  }
}
