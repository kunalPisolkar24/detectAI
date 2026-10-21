import type { LogFn, Logger } from "pino"
import type { LogAttributes, LogLevel } from "./sink"

// pino reports levels as numbers; map them onto the sink's vocabulary.
const LEVEL_NAMES: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
}

// pino accepts either a plain string or a structured object. Lift the message
// out of the record and treat every remaining field as an attribute.
export function splitArgs(args: unknown[]): { message: string; attributes: LogAttributes } {
  const [first, second] = args
  const attributes: LogAttributes = {}

  if (typeof first === "string") {
    return { message: first, attributes }
  }

  if (first instanceof Error) {
    attributes.error = first.message
    return { message: typeof second === "string" ? second : first.message, attributes }
  }

  if (first && typeof first === "object") {
    const record = first as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (key === "msg" || key === "message") continue
      attributes[key] = value
    }
    const fromRecord =
      typeof record.msg === "string" ? record.msg : typeof record.message === "string" ? record.message : ""
    return { message: typeof second === "string" ? second : fromRecord, attributes }
  }

  return { message: typeof second === "string" ? second : "", attributes }
}

export type LogForwarder = (level: LogLevel, message: string, attributes: LogAttributes) => void

// pino swaps every level method for this hook, so the original logger has to
// be invoked here or nothing would reach stdout.
export function createLogMethodHook(forward: LogForwarder) {
  return function logMethod(this: Logger, args: unknown[], method: LogFn, level: number): void {
    method.apply(this, args)

    const name = LEVEL_NAMES[level]
    if (!name) return

    const { message, attributes } = splitArgs(args)
    forward(name, message, attributes)
  }
}
