import { LogRingBuffer, type LogLevel, type LogSource } from '../src/lib/logBus';

export const serverLogs = new LogRingBuffer(500);

export function emitLog(level: LogLevel, source: LogSource, message: string, meta?: string): void {
  serverLogs.push(level, source, message, meta);
}
