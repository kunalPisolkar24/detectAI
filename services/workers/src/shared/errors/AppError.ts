export class MissingFieldError extends Error {
  constructor(public readonly field: string) {
    super(`Missing required field: ${field}`);
    this.name = "MissingFieldError";
  }
}
