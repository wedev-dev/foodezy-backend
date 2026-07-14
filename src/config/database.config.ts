import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * Builds the MySQL connection options from environment variables.
 * `synchronize` is OFF — the schema is owned by the imported SQL dump,
 * TypeORM must never alter it.
 */
export function buildDatabaseConfig(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: config.get<string>('DB_HOST', 'localhost'),
    port: config.get<number>('DB_PORT', 3306),
    username: config.get<string>('DB_USER', 'root'),
    password: config.get<string>('DB_PASSWORD', ''),
    database: config.get<string>('DB_NAME', 'foodezy'),
    charset: 'utf8mb4_unicode_ci',
    timezone: '+07:00',
    synchronize: false,
    autoLoadEntities: true,
    extra: {
      connectionLimit: 10,
    },
  };
}
