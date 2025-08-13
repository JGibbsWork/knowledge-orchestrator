import pino from 'pino';
import type { Env } from './env.js';

export function createLogger(env: Env) {
  const config: any = {
    level: env.LOG_LEVEL,
  };

  if (env.NODE_ENV === 'development') {
    config.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(config);
}