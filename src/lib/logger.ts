import { logs, SeverityNumber } from '@opentelemetry/api-logs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SEVERITY_MAP: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function getMinLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return env in LEVEL_ORDER ? (env as LogLevel) : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getMinLevel()];
}

function formatMessage(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${component}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

function emitOtelLog(level: LogLevel, component: string, message: string, data?: Record<string, unknown>) {
  try {
    const otelLogger = logs.getLogger('a11y-scanner');
    otelLogger.emit({
      severityNumber: SEVERITY_MAP[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: {
        'log.component': component,
        ...(data as Record<string, string | number | boolean | undefined>),
      },
    });
  } catch {
    // OTel logger may not be initialized yet (e.g. during startup)
  }
}

export function createLogger(component: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', component, message, data));
        emitOtelLog('debug', component, message, data);
      }
    },
    info(message: string, data?: Record<string, unknown>) {
      if (shouldLog('info')) {
        console.log(formatMessage('info', component, message, data));
        emitOtelLog('info', component, message, data);
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', component, message, data));
        emitOtelLog('warn', component, message, data);
      }
    },
    error(message: string, data?: Record<string, unknown>) {
      if (shouldLog('error')) {
        console.error(formatMessage('error', component, message, data));
        emitOtelLog('error', component, message, data);
      }
    },
  };
}
