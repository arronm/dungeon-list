export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfter: number | undefined;

  constructor(statusCode: number, code: string, message: string, options: { retryAfter?: number } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfter = options.retryAfter;
  }
}
