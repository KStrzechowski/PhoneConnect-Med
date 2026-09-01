import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { dataSourceOptions } from './data-source';
import { FacilityModule } from './facility/facility.module';
import { PatientModule } from './patient/patient.module';

@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions), FacilityModule, PatientModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
