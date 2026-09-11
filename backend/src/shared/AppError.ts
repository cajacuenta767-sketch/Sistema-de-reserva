export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  INTERNAL: 500,
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

  static notFound(what: string) {
    return new AppError('NOT_FOUND', `${what} no encontrado`);
  }
  static forbidden(msg = 'No tienes permisos para esta acción') {
    return new AppError('FORBIDDEN', msg);
  }
  static unauthorized(msg = 'Credenciales inválidas') {
    return new AppError('UNAUTHORIZED', msg);
  }
  static rule(msg: string, details?: unknown) {
    return new AppError('BUSINESS_RULE', msg, details);
  }
  static conflict(msg: string, details?: unknown) {
    return new AppError('CONFLICT', msg, details);
  }
  static validation(msg: string, details?: unknown) {
    return new AppError('VALIDATION_ERROR', msg, details);
  }
}
