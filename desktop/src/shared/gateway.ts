// IM 网关(QQ)共享类型 —— main / preload / renderer 三端共用。
// ⚠ 密钥红线:clientSecret 明文绝不出现在任何发往 renderer 的结构里。

export type GatewayState = 'stopped' | 'starting' | 'running' | 'error'

export interface GatewayStatus {
  state: GatewayState
  /** error 态的可读原因;其它态可空。 */
  message?: string
}

/** 给 renderer 的安全配置视图 —— 只报 hasSecret,绝不含明文。 */
export interface GatewayConfigView {
  bound: boolean
  hasSecret: boolean
  appId: string | null
  ownerOpenid: string | null
  workspace: string | null
}

export type GatewayBindPhase = 'scanning' | 'bound' | 'secret-invalid' | 'failed' | 'cancelled'

export type GatewayEvent =
  | { kind: 'status'; status: GatewayStatus }
  | { kind: 'bind'; phase: GatewayBindPhase; message?: string }
