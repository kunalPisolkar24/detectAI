export function dlxName(queue: string): string {
  return `${queue}_dlx`;
}
export function dlqName(queue: string): string {
  return `${queue}_dlq`;
}
export function retryExchangeName(queue: string): string {
  return `${queue}_retry_exchange`;
}
export function retryQueueName(queue: string): string {
  return `${queue}_retry`;
}

export const RETRY_TTL_MS = 5000;
export const MAX_RETRIES = 5;
