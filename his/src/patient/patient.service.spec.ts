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
    const patient = await service.verify('12345678901', '+48518823031');

    expect(patient).toEqual(
      expect.objectContaining({
        pesel: '12345678901',
        phone: '+48518823031',
        firstName: 'Jan',
        lastName: 'Kowalski',
      }),
    );
  });

  it('does not match a real pesel with the wrong phone', async () => {
    const patient = await service.verify('12345678901', '+48111111111');

    expect(patient).toBeNull();
  });

  it('does not match an unknown pesel', async () => {
    const patient = await service.verify('00000000000', '+48000000000');

    expect(patient).toBeNull();
  });

  it('matches the seeded demo pesel and phone pair', async () => {
    const patient = await service.verify('09876543210', '+48123456789');

    expect(patient).toEqual(
      expect.objectContaining({
        pesel: '09876543210',
        phone: '+48123456789',
        firstName: 'Anna',
        lastName: 'Demo',
        isDemo: true,
        demoOtpCode: '123456',
      }),
    );
  });

  it('does not carry a demo flag on the non-demo patient', async () => {
    const patient = await service.verify('12345678901', '+48518823031');

    expect(patient).toEqual(
      expect.objectContaining({
        isDemo: false,
        demoOtpCode: null,
      }),
    );
  });
});
