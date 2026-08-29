import * as path from 'node:path';
import { DataSource } from 'typeorm';
import { Facility } from './facility/facility.entity';

export const dataSourceOptions = {
  type: 'postgres' as const,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USERNAME ?? 'his',
  password: process.env.DB_PASSWORD ?? 'his',
  database: process.env.DB_DATABASE ?? 'his',
  entities: [Facility],
  synchronize: false,
};

export default new DataSource({
  ...dataSourceOptions,
  migrations: [path.join(__dirname, 'migrations', '*.{js,ts}')],
});
