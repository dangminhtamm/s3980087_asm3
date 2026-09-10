/** Error that is safe to serialize and return to an API client. */
export class AppError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
