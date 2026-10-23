/**
 * Registro de diagnóstico compartido por la extensión y la web.
 * - Escribe en la consola con el prefijo [LiveAudio:<módulo>].
 * - Guarda las últimas entradas en memoria para mostrarlas en pantalla
 *   (útil en el celular, donde no hay consola).
 * Nunca se deben registrar claves de API.
 */
const MAX_ENTRIES = 400;
const entries = [];
const listeners = new Set();
let consoleOutput = true;

const STYLES = {
  debug: 'color:#64748b',
  info: 'color:#38bdf8;font-weight:600',
  warn: 'color:#f59e0b;font-weight:600',
  error: 'color:#f43f5e;font-weight:600'
};

export function createLogger(scope) {
  const write = (level, message, data) => {
    const entry = { ts: Date.now(), level, scope, message, data };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    if (consoleOutput) {
      const args = [`%c[LiveAudio:${scope}]`, STYLES[level], message];
      if (data !== undefined) args.push(data);
      console[level](...args);
    }
    for (const listener of listeners) listener(entry);
  };
  return {
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data)
  };
}

export function getLogEntries() {
  return entries.slice();
}

export function clearLog() {
  entries.length = 0;
}

export function onLog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Desactiva la salida por consola (pruebas automáticas). */
export function setConsoleLogging(enabled) {
  consoleOutput = enabled;
}

export function formatLogEntry({ ts, level, scope, message, data }) {
  const time = new Date(ts).toISOString().slice(11, 23);
  let extra = '';
  if (data !== undefined) {
    try {
      extra = ` ${typeof data === 'string' ? data : JSON.stringify(data)}`;
    } catch {
      extra = ` ${String(data)}`;
    }
  }
  return `${time} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra}`;
}
