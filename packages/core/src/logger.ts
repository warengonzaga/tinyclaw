import { LogEngine, LogMode } from '@wgtechlabs/log-engine';

// Configure based on environment
const env = process.env.NODE_ENV || 'development';
LogEngine.configure({
  mode: env === 'production' ? LogMode.INFO : LogMode.DEBUG
});

// Re-export configured logger
export const logger = LogEngine;
