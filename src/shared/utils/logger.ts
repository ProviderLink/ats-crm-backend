import winston from 'winston';
import { env } from '../../config/env';

const { combine, timestamp, printf, json } = winston.format;

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
};

const LEVELS: Record<string, { symbol: string; color: string; label: string }> = {
  error: { symbol: '✖', color: c.red,    label: 'ERROR' },
  warn:  { symbol: '⚠', color: c.yellow, label: 'WARN ' },
  info:  { symbol: '✔', color: c.green,  label: 'INFO ' },
  http:  { symbol: '→', color: c.cyan,   label: 'HTTP ' },
  debug: { symbol: '◈', color: c.gray,   label: 'DEBUG' },
};

function colorStatus(code: number): string {
  const col = code >= 500 ? c.red : code >= 400 ? c.yellow : code >= 300 ? c.cyan : c.green;
  return `${col}${c.bold}${code}${c.reset}`;
}

const INTERNAL_FIELDS = new Set(['method', 'url', 'status', 'duration', 'ip', 'splat', 'service']);

const devFormat = combine(
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const lv = LEVELS[level] ?? { symbol: '•', color: c.white, label: level.toUpperCase().padEnd(5) };
    const time  = `${c.dim}[${ts}]${c.reset}`;
    const badge = `${lv.color}${c.bold}${lv.symbol} ${lv.label}${c.reset}`;

    // HTTP request — structured one-liner with colored status code
    if (level === 'http' && meta.status !== undefined) {
      const method   = `${c.bold}${String(meta.method).padEnd(6)}${c.reset}`;
      const url      = `${c.white}${meta.url}${c.reset}`;
      const status   = colorStatus(meta.status as number);
      const duration = `${c.dim}${meta.duration}ms${c.reset}`;
      const ip       = meta.ip ? `  ${c.dim}${meta.ip}${c.reset}` : '';
      return `${time} ${badge}  ${method} ${url} ${status} ${duration}${ip}`;
    }

    // Standard log — message, then any extra meta below it
    const extra = Object.fromEntries(
      Object.entries(meta).filter(([k]) => !INTERNAL_FIELDS.has(k))
    );
    const metaStr = Object.keys(extra).length
      ? `\n${c.dim}${
          JSON.stringify(extra, null, 2)
            .split('\n')
            .map(line => '           ' + line)
            .join('\n')
        }${c.reset}`
      : '';

    return `${time} ${badge}  ${message}${metaStr}`;
  })
);

const prodFormat = combine(timestamp(), json());

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'http',
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
});

if (env.NODE_ENV === 'production') {
  console.log = (...args) => logger.info(args.join(' '));
  console.error = (...args) => logger.error(args.join(' '));
  console.warn = (...args) => logger.warn(args.join(' '));
  console.info = (...args) => logger.info(args.join(' '));
}

export default logger;
