/**
 * Errores con código para que la interfaz pueda mostrar mensajes claros
 * y ofrecer acciones (p. ej. "Conceder permiso").
 */
export class AppError extends Error {
  constructor(code, message, { fatal = true, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.fatal = fatal;
  }
}

export function serializeError(error) {
  if (!error) return { code: 'unknown', message: 'Error desconocido.' };
  return {
    code: error.code || error.name || 'unknown',
    message: error.message || String(error),
    fatal: error.fatal !== false
  };
}
