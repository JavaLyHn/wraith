import type { WecomConfigFields } from '../../shared/gateway'

/**
 * 把企微表单输入映射为下发字段:trim 后非空的才带上。
 * 空白 = 不改动该字段(尤其空 secret 不下发,保留后端已存密钥)。
 */
export function wecomConfigPayload(inputs: {
  botId: string
  secret: string
  ownerUserid: string
  workspace: string
}): WecomConfigFields {
  const out: WecomConfigFields = {}
  const put = (k: keyof WecomConfigFields, v: string) => {
    const t = v.trim()
    if (t) out[k] = t
  }
  put('botId', inputs.botId)
  put('secret', inputs.secret)
  put('ownerUserid', inputs.ownerUserid)
  put('workspace', inputs.workspace)
  return out
}
