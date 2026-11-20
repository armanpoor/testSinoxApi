export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogSource = 'server' | 'engine' | 'bridge' | 'throttle' | 'watchdog' | 'sync';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  meta?: string;
}

export interface LogFilter {
  level?: LogLevel | 'all';
  source?: LogSource | 'all';
  query?: string;
}

export class LogRingBuffer {
  private entries: LogEntry[] = [];
  private listeners = new Set<(entry: LogEntry) => void>();
  private seq = 0;

  constructor(private readonly maxEntries = 500) {}

  push(level: LogLevel, source: LogSource, message: string, meta?: string): LogEntry {
    this.seq += 1;
    const entry: LogEntry = {
      id: `${Date.now().toString(36)}-${this.seq}`,
      ts: Date.now(),
      level,
      source,
      message,
      ...(meta ? { meta } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Isolate subscriber errors
      }
    }
    return entry;
  }

  list(filter?: LogFilter): LogEntry[] {
    return filterLogs(this.entries, filter);
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function filterLogs(entries: LogEntry[], filter?: LogFilter): LogEntry[] {
  if (!filter) return [...entries];
  const q = (filter.query || '').trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.level && filter.level !== 'all' && e.level !== filter.level) return false;
    if (filter.source && filter.source !== 'all' && e.source !== filter.source) return false;
    if (q) {
      const hay = `${e.message} ${e.meta || ''} ${e.source} ${e.level}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function formatLogsAsText(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const iso = new Date(e.ts).toISOString();
      const lvl = e.level.toUpperCase().padEnd(5, ' ');
      const src = e.source.toUpperCase().padEnd(8, ' ');
      return `[${iso}] [${lvl}] [${src}] ${e.message}${e.meta ? ` | ${e.meta}` : ''}`;
    })
    .join('\n');
}
