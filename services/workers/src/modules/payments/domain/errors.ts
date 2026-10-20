export class UserNotFoundError extends Error {
  constructor(public readonly identifier: string) {
    super(`User not found: ${identifier}`);
    this.name = "UserNotFoundError";
  }
}

/**
 * Raised when an event arrives for a type no handler is registered for.
 * Non-retryable: the message is dead-lettered rather than acknowledged, so it
 * stays available for replay once a handler for the type ships.
 */
export class UnhandledEventError extends Error {
  constructor(public readonly eventType: string) {
    super(`No handler registered for event type: ${eventType}`);
    this.name = "UnhandledEventError";
  }
}

export { MissingFieldError } from "@shared/errors/AppError";
