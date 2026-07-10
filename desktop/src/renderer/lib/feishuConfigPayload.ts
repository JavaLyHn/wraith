import type { FeishuConfigFields } from '../../shared/gateway'

/**
 * 把飞书表单输入映射为下发字段:trim 后非空的才带上。
 * 空白 = 不改动该字段(尤其空 appSecret 不下发,保留后端已存密钥;region 恒有下拉值)。
 */
export function feishuConfigPayload(inputs: {
  appId: string
  appSecret: string
  ownerOpenid: string
  region: string
  workspace: string
}): FeishuConfigFields {
  const out: FeishuConfigFields = {}
  const put = (k: keyof FeishuConfigFields, v: string) => {
    const t = v.trim()
    if (t) out[k] = t
  }
  put('appId', inputs.appId)
  put('appSecret', inputs.appSecret)
  put('ownerOpenid', inputs.ownerOpenid)
  put('region', inputs.region)
  put('workspace', inputs.workspace)
  return out
}
