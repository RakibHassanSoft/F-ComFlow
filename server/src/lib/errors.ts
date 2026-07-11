// A tiny error class so routes can throw errors with an HTTP status.
// The global error handler in index.ts turns these into clean JSON responses.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
