import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '../data-source';
import { PatientModule } from './patient.module';
import { PatientService } from './patient.service';

describe('PatientService', () => {
  let module: TestingModule;
  let service: PatientService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(dataSourceOptions), PatientModule],
    }).compile();

    service = module.get<PatientService>(PatientService);
  });

  afterAll(() => module.close());

  it('matches the seeded pesel and phone pair', async () => {
    const patient = await service.verify('90010112345', '+48000000000');

    expect(patient).toEqual(
      expect.objectContaining({
        pesel: '90010112345',
        phone: '+48000000000',
        firstName: 'Jan',
        lastName: 'Kowalski',
      }),
    );
  });

  it('does not match a real pesel with the wrong phone', async () => {
    const patient = await service.verify('90010112345', '+48111111111');

    expect(patient).toBeNull();
  });

  it('does not match an unknown pesel', async () => {
    const patient = await service.verify('00000000000', '+48000000000');

    expect(patient).toBeNull();
  });
});
