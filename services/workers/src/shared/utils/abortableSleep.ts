export function abortableSleep(ms: number, signal: AbortSignal, onAbort?: () => void): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) {
            onAbort?.();
            return resolve();
        }
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                onAbort?.();
                resolve();
            },
            { once: true }
        );
    });
}
