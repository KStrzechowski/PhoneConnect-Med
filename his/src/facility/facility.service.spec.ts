import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '../data-source';
import { FacilityModule } from './facility.module';
import { FacilityService } from './facility.service';

describe('FacilityService', () => {
  let module: TestingModule;
  let service: FacilityService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(dataSourceOptions), FacilityModule],
    }).compile();

    service = module.get<FacilityService>(FacilityService);
  });

  afterAll(() => module.close());

  it('returns the seeded facility row', async () => {
    const facility = await service.findOne();

    expect(facility).toEqual(
      expect.objectContaining({
        name: 'Przychodnia Zdrowie',
        address: 'ul. Kwiatowa 12, 00-001 Warszawa',
        opensAt: '08:00',
        closesAt: '18:00',
        openDays: 'monday-friday',
      }),
    );
  });
});
