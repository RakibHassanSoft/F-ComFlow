// Tiny error class carrying an HTTP status; index.ts turns it into JSON.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
