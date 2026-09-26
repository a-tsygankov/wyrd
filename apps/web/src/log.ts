/**
 * Client log: a small ring buffer mirrored to the console. The admin
 * console (triple-tap the title) shows it, so a tester can say what the
 * app was doing when something felt wrong without a laptop attached.
 */
export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
    ts: number;
    level: LogLevel;
    message: string;
    data?: unknown;
};

export type Log = {
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    entries(): readonly LogEntry[];
    subscribe(listener: (entry: LogEntry) => void): () => void;
};

export type LogOptions = {
    capacity?: number;
    now?: () => number;
    sink?: (entry: LogEntry) => void;
};

function consoleSink(entry: LogEntry): void {
    const line = `[wyrd] ${entry.message}`;
    if (entry.level === "error") console.error(line, entry.data ?? "");
    else if (entry.level === "warn") console.warn(line, entry.data ?? "");
    else console.info(line, entry.data ?? "");
}

export function createLog(options: LogOptions = {}): Log {
    const capacity = options.capacity ?? 200;
    const now = options.now ?? (() => Date.now());
    const sink = options.sink ?? consoleSink;
    const buffer: LogEntry[] = [];
    const listeners = new Set<(entry: LogEntry) => void>();

    const push = (level: LogLevel, message: string, data?: unknown): void => {
        const entry: LogEntry = data === undefined ? { ts: now(), level, message } : { ts: now(), level, message, data };
        buffer.push(entry);
        if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
        sink(entry);
        for (const listener of listeners) listener(entry);
    };

    return {
        info: (message, data) => push("info", message, data),
        warn: (message, data) => push("warn", message, data),
        error: (message, data) => push("error", message, data),
        entries: () => buffer,
        subscribe: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
}
