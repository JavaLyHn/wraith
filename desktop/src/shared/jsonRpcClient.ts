/**
 * JsonRpcClient — pure-TS JSON-RPC 2.0 JSONL framing layer.
 *
 * No Electron, no Node built-ins (child_process, fs, …). Only JSON/Map/Promise.
 * This keeps the module fully unit-testable with vitest without a runtime.
 *
 * Framing contract:
 *   - Each outbound message is a single line (no embedded newlines).
 *   - Each inbound line is one JSON object.
 *   - Responses: { id, result } → resolve; { id, error } → reject.
 *   - Notifications: { method } with no matching pending id → dispatch.
 *   - Malformed lines are swallowed silently.
 */

type NotificationCallback = (method: string, params: unknown) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export class JsonRpcClient {
  private readonly writeLine: (line: string) => void
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Set<NotificationCallback>()

  constructor(writeLine: (line: string) => void) {
    this.writeLine = writeLine
  }

  /**
   * Send a JSON-RPC 2.0 request.
   * Returns a Promise that resolves with `result` or rejects with the `error`.
   */
  request(method: string, params: object): Promise<unknown> {
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      this.writeLine(message)
    })
  }

  /**
   * Feed one inbound line from the child process's stdout.
   * Malformed / non-JSON lines are silently ignored.
   */
  handleLine(line: string): void {
    if (!line || !line.trim()) return

    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      // Swallow malformed input — must not throw.
      return
    }

    // Response: has numeric id and result or error field.
    if (typeof msg['id'] === 'number' && ('result' in msg || 'error' in msg)) {
      const id = msg['id'] as number
      const pending = this.pending.get(id)
      if (pending) {
        this.pending.delete(id)
        if ('result' in msg) {
          pending.resolve(msg['result'])
        } else {
          const err = msg['error'] as Record<string, unknown> | undefined
          const message =
            typeof err?.['message'] === 'string'
              ? err['message']
              : JSON.stringify(err)
          pending.reject(new Error(message))
        }
      }
      return
    }

    // Notification: has a method field (and no matching pending id).
    if (typeof msg['method'] === 'string') {
      const method = msg['method'] as string
      const params = msg['params']
      for (const cb of this.listeners) {
        cb(method, params)
      }
    }
    // Anything else is silently ignored.
  }

  /**
   * Register a callback for server-push notifications.
   * Returns an unsubscribe function.
   */
  onNotification(cb: NotificationCallback): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /**
   * Reject all pending requests (e.g. child process disconnected).
   * Clears the pending map.
   */
  rejectAll(reason: string): void {
    const err = new Error(reason)
    for (const [, pending] of this.pending) {
      pending.reject(err)
    }
    this.pending.clear()
  }
}
