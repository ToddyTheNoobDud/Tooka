// One-shot waiter for a voice gateway op. Chains onto the socket's current
// onmessage so heartbeat acks and DAVE traffic keep flowing while waiting,
// then restores it. The caller wires close-during-handshake rejection by
// assigning the returned reject to its own abort hook.

export interface GatewayWait<T> {
  promise: Promise<T>
  reject: (error: Error) => void
}

export function waitForGatewayOp<T>(
  ws: WebSocket,
  op: number,
  timeoutMs: number,
  timeoutMessage: string,
  parse: (data: unknown) => T,
  onOtherStringPayload?: (payload: { op: number; d: unknown }) => void
): GatewayWait<T> {
  let rejectWait!: (error: Error) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectWait = reject
    const timeout = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
    timeout.unref?.()
    const previous = ws.onmessage
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const payload = JSON.parse(event.data) as { op: number; d: unknown }
        if (payload.op === op) {
          clearTimeout(timeout)
          ws.onmessage = previous
          resolve(parse(payload.d))
          return
        }
        onOtherStringPayload?.(payload)
      }
      void previous?.call(ws, event)
    }
  })
  return { promise, reject: (error) => rejectWait(error) }
}
