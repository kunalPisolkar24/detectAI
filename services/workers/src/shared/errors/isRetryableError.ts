import { UserNotFoundError, MissingFieldError } from "@modules/payments/domain/errors";
import { InvalidTransitionError } from "@modules/payments/domain/stateMachine";

const NON_RETRYABLE_NAMES = new Set([
    "UserNotFoundError",
    "MissingFieldError",
    "InvalidTransitionError",
    "SyntaxError",
]);

export function isRetryableError(error: unknown): boolean {
    if (error instanceof UserNotFoundError) return false;
    if (error instanceof MissingFieldError) return false;
    if (error instanceof InvalidTransitionError) return false;
    if (error instanceof SyntaxError) return false;
    const name = (error as any)?.name;
    if (typeof name === "string" && NON_RETRYABLE_NAMES.has(name)) return false;
    return true;
}
