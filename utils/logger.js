function write(level, message, meta) {
  const timestamp = new Date().toISOString();
  const suffix = meta ? ` ${formatMeta(meta)}` : '';
  console[level](`[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`);
}

function formatMeta(meta) {
  if (meta instanceof Error) {
    return `${meta.message}\n${meta.stack || ''}`;
  }

  if (typeof meta === 'object') {
    return JSON.stringify(meta);
  }

  return String(meta);
}

const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};

module.exports = { logger };
