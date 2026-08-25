export class UserNotFoundError extends Error {
    constructor(public readonly identifier: string) {
        super(`User not found: ${identifier}`);
        this.name = "UserNotFoundError";
    }
}
