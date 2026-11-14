import type { ReportFailure } from '@liasse/mcp';
import { describeError, type Logger } from './log.ts';

/** Logs what failed in a tool or a resource, by its class only, whatever the transport. */
export const reportMcpFailure =
  (logger: Logger): ReportFailure =>
  (operation, error) => {
    logger.event('mcp_failed', { operation, ...describeError(error) });
  };
