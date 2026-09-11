/**
 * Error de aplicación con código semántico. El código determina el status HTTP,
 * de modo que ningún caso de uso necesita conocer el protocolo.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'PERIOD_CLOSED'
  | 'RATE_LIMITED'
  | 'PAYMENT_REQUIRED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  PERIOD_CLOSED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }

  static notFound(what: string): AppError {
    return new AppError('NOT_FOUND', `${what} no encontrado`);
  }
  static forbidden(msg = 'No tienes permisos para esta acción', details?: unknown): AppError {
    return new AppError('FORBIDDEN', msg, details);
  }
  static unauthorized(msg = 'Credenciales inválidas'): AppError {
    return new AppError('UNAUTHORIZED', msg);
  }
  static rule(msg: string, details?: unknown): AppError {
    return new AppError('BUSINESS_RULE', msg, details);
  }
  static conflict(msg: string, details?: unknown): AppError {
    return new AppError('CONFLICT', msg, details);
  }
  static validation(msg: string, details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', msg, details);
  }
  /** El periodo contable está cerrado: no admite movimientos. */
  static periodClosed(period: string): AppError {
    return new AppError('PERIOD_CLOSED', `El periodo ${period} está cerrado y no admite movimientos`);
  }
  static rateLimited(msg = 'Demasiadas solicitudes, inténtalo más tarde'): AppError {
    return new AppError('RATE_LIMITED', msg);
  }
  static notImplemented(what: string): AppError {
    return new AppError('NOT_IMPLEMENTED', `${what} todavía no está disponible`);
  }
  static internal(msg = 'Error interno', details?: unknown): AppError {
    return new AppError('INTERNAL', msg, details);
  }

  static is(e: unknown): e is AppError {
    return e instanceof AppError;
  }
}
