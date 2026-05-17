export class Logger {
    static info(message: string, context?: Record<string, any>) {
        console.log(JSON.stringify({ level: 'info', message, ...context, timestamp: new Date().toISOString() }));
    }

    static error(message: string, error?: any, context?: Record<string, any>) {
        console.error(JSON.stringify({ 
            level: 'error', 
            message, 
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            ...context, 
            timestamp: new Date().toISOString() 
        }));
    }

    static warn(message: string, context?: Record<string, any>) {
        console.warn(JSON.stringify({ level: 'warn', message, ...context, timestamp: new Date().toISOString() }));
    }
}