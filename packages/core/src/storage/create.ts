import type { Config } from '../config/schema.ts';
import { createFsStorage } from './fs.ts';
import type { Storage } from './port.ts';
import { createS3Storage } from './s3.ts';

export const createStorage = (config: Config['storage']): Storage =>
  config.driver === 'fs' ? createFsStorage(config.path) : createS3Storage(config);
