const NON_RETRYABLE = new Set([
  "UserNotFoundError",
  "MissingFieldError",
  "InvalidTransitionError",
  "UnhandledEventError",
  "SyntaxError",
]);

export function isRetryableError(error: unknown): boolean {
  if (error instanceof SyntaxError) return false;
  const name = (error as any)?.name;
  if (typeof name === "string" && NON_RETRYABLE.has(name)) return false;
  return true;
}
