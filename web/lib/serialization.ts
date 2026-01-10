export class JsonSerializer {
  private static readonly DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,})?Z$/

  private static reviver(_key: string, value: unknown): unknown {
    if (typeof value === "string" && JsonSerializer.DATE_REGEX.test(value)) {
      return new Date(value)
    }
    return value
  }

  public static serialize<T>(data: T): string {
    return JSON.stringify(data)
  }

  public static deserialize<T>(data: string): T {
    return JSON.parse(data, JsonSerializer.reviver) as T
  }
}