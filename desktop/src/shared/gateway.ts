// IM 网关共享类型(QQ / 飞书)—— main / preload / renderer 三端共用。
// ⚠ 密钥红线:clientSecret / appSecret 明文绝不出现在任何发往 renderer 的结构里。

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
  region?: string | null   // 飞书专用;QQ 视图无此字段
  botId?: string | null        // 企微专用;QQ/飞书视图无此字段
  ownerUserid?: string | null  // 企微专用
}

/** 飞书配置写入字段(全可选;空字段调用方应省略以免覆盖已存值)。 */
export interface FeishuConfigFields {
  appId?: string
  appSecret?: string
  ownerOpenid?: string
  region?: string
  workspace?: string
}

/** 企微配置写入字段(全可选;空字段调用方应省略以免覆盖已存值)。 */
export interface WecomConfigFields {
  botId?: string
  secret?: string
  ownerUserid?: string
  workspace?: string
}

/** 微信配置写入字段:仅 workspace 可改(token/owner 由扫码绑定写入账号店)。 */
export interface WeixinConfigFields {
  workspace?: string
}

export type GatewayBindPhase = 'scanning' | 'bound' | 'secret-invalid' | 'failed' | 'cancelled'

export type GatewayEvent =
  | { kind: 'status'; status: GatewayStatus }
  // qr:微信扫码绑定时的二维码 data URL(image/png);仅 scanning 阶段带,由桌面渲染成 <img>。
  // url:扫码失败时的兜底链接;仅 scanning 阶段带,由桌面渲染成可点链接(不再自动开浏览器)。
  | { kind: 'bind'; phase: GatewayBindPhase; message?: string; qr?: string; url?: string }
  | { kind: 'qq-flushed'; count: number }
