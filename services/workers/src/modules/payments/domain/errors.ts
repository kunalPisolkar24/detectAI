export class UserNotFoundError extends Error {
    constructor(public readonly identifier: string) {
        super(`User not found: ${identifier}`);
        this.name = "UserNotFoundError";
    }
}

export class MissingFieldError extends Error {
    constructor(public readonly field: string) {
        super(`Missing required field: ${field}`);
        this.name = "MissingFieldError";
    }
}
