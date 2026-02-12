import { LogEngine, LogMode } from '@wgtechlabs/log-engine';

// Only local time
LogEngine.configure({ 
  mode: LogMode.DEBUG,
  format: {
    includeIsoTimestamp: false,
    includeLocalTime: true
  }
});

// Re-export configured logger
export const logger = LogEngine;
