import { Body, Controller, Post } from '@nestjs/common';
import { PatientService } from './patient.service';

@Controller('patient')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Post('verify')
  async verify(@Body() body: { pesel: string; phone: string }) {
    const patient = await this.patientService.verify(body.pesel, body.phone);
    if (!patient) return { matched: false };
    return { matched: true, id: patient.id, firstName: patient.firstName, lastName: patient.lastName };
  }
}
