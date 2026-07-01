/**
 * Shared protocol types for the Wraith desktop shell ↔ Java app-server IPC.
 * Framing: JSON-RPC 2.0, one JSON object per line (JSONL) on child-process stdin/stdout.
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire shapes
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: object
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  id: number
  result: unknown
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: number
  error: JsonRpcErrorObject
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type JsonRpcInbound =
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification

// ---------------------------------------------------------------------------
// Backend event catalog (notifications from app-server → renderer)
// ---------------------------------------------------------------------------

/** Streaming text delta from an assistant turn. */
export interface MessageDeltaEvent {
  type: 'message.delta'
  text: string
}

/** The current assistant turn is complete. */
export interface MessageDoneEvent {
  type: 'message.done'
}

/** An error surfaced by the backend. */
export interface BackendErrorEvent {
  type: 'error'
  code: string
  message: string
}

/** Agent state snapshot (thinking / executing / idle). */
export interface AgentStateEvent {
  type: 'agent.state'
  state: 'idle' | 'thinking' | 'executing'
}

/** A tool call the agent is about to perform. */
export interface ToolCallEvent {
  type: 'tool.call'
  name: string
  input: unknown
}

/** Result of a completed tool call. */
export interface ToolResultEvent {
  type: 'tool.result'
  name: string
  output: unknown
}

/** Union of all backend push events. */
export type BackendEvent =
  | MessageDeltaEvent
  | MessageDoneEvent
  | BackendErrorEvent
  | AgentStateEvent
  | ToolCallEvent
  | ToolResultEvent
