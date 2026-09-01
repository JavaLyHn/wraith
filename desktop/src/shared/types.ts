/**
 * Shared protocol types for the Wraith desktop shell ↔ Java app-server IPC.
 * Framing: JSON-RPC 2.0, one JSON object per line (JSONL) on child-process stdin/stdout.
 *
 * This file is a barrel — types are split by domain into ./types/*.ts.
 * Import paths stay unchanged; all named exports are re-exported here.
 */

export * from './types/protocol'
export * from './types/core'
export * from './types/data'
export * from './types/policy'
export * from './types/rag'
export * from './types/skill'
export * from './types/automation'
export * from './types/runmode'
export * from './types/system'
