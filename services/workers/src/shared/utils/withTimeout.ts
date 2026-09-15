export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>(resolve => {
        timeout = setTimeout(() => resolve(fallback), ms);
    });
    promise.catch(() => {});
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        return result;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}
