import { describe, test, expect, vi } from 'vitest'
import { JsonRpcClient } from '../src/shared/jsonRpcClient'

describe('JsonRpcClient', () => {
  // Test 1: request writes a valid JSON-RPC 2.0 line; handleLine with matching result resolves the promise
  test('request writes valid JSON-RPC line and resolves on matching result', async () => {
    const lines: string[] = []
    const client = new JsonRpcClient((line) => lines.push(line))

    const promise = client.request('initialize', {})

    // Check the written line
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.jsonrpc).toBe('2.0')
    expect(typeof parsed.id).toBe('number')
    expect(parsed.id).toBeGreaterThan(0)
    expect(parsed.method).toBe('initialize')
    expect(parsed.params).toEqual({})

    // Feed matching result
    client.handleLine(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { ok: true } }))

    const result = await promise
    expect(result).toEqual({ ok: true })
  })

  // Test 2: Two concurrent requests get distinct ids; results out of order settle correct promises
  test('two concurrent requests have distinct ids and settle correctly out of order', async () => {
    const lines: string[] = []
    const client = new JsonRpcClient((line) => lines.push(line))

    const p1 = client.request('method.a', { x: 1 })
    const p2 = client.request('method.b', { x: 2 })

    const req1 = JSON.parse(lines[0])
    const req2 = JSON.parse(lines[1])

    expect(req1.id).not.toBe(req2.id)
    expect(req1.method).toBe('method.a')
    expect(req2.method).toBe('method.b')

    // Feed results out of order: p2 first, then p1
    client.handleLine(JSON.stringify({ jsonrpc: '2.0', id: req2.id, result: { from: 'b' } }))
    client.handleLine(JSON.stringify({ jsonrpc: '2.0', id: req1.id, result: { from: 'a' } }))

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ from: 'a' })
    expect(r2).toEqual({ from: 'b' })
  })

  // Test 3: An error response rejects the promise with the error message
  test('error response rejects with error message', async () => {
    const lines: string[] = []
    const client = new JsonRpcClient((line) => lines.push(line))

    const promise = client.request('fail', {})
    const req = JSON.parse(lines[0])

    client.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32600, message: 'Invalid Request' } })
    )

    await expect(promise).rejects.toThrow('Invalid Request')
  })

  // Test 4: Notification line dispatches onNotification; unsubscribe stops further callbacks
  test('notification dispatches onNotification and unsubscribe stops further callbacks', () => {
    const lines: string[] = []
    const client = new JsonRpcClient((line) => lines.push(line))

    const received: Array<{ method: string; params: any }> = []
    const unsub = client.onNotification((method, params) => {
      received.push({ method, params })
    })

    // Feed a notification (no id)
    client.handleLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'message.delta', params: { text: 'hi' } })
    )

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ method: 'message.delta', params: { text: 'hi' } })

    // Unsubscribe and feed another notification — should not be received
    unsub()
    client.handleLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'message.delta', params: { text: 'bye' } })
    )

    expect(received).toHaveLength(1)
  })

  // Test 5: Malformed line does not throw and does not affect subsequent valid lines
  test('malformed line is swallowed silently and does not affect subsequent valid lines', async () => {
    const lines: string[] = []
    const client = new JsonRpcClient((line) => lines.push(line))

    const promise = client.request('ping', {})
    const req = JSON.parse(lines[0])

    // Feed garbage — must not throw
    expect(() => client.handleLine('not json')).not.toThrow()
    expect(() => client.handleLine('{broken')).not.toThrow()
    expect(() => client.handleLine('')).not.toThrow()

    // Feed valid result afterwards — promise still resolves
    client.handleLine(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: 'pong' }))

    const result = await promise
    expect(result).toBe('pong')
  })

  // Test 6: rejectAll rejects all pending requests with the given reason
  test('rejectAll rejects all pending requests', async () => {
    const lines: string[] = []
    const client = new JsonRpcClient((line) => lines.push(line))

    const p1 = client.request('long.op.1', {})
    const p2 = client.request('long.op.2', {})

    client.rejectAll('disconnected')

    await expect(p1).rejects.toThrow('disconnected')
    await expect(p2).rejects.toThrow('disconnected')
  })
})
