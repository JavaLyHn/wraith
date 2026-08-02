/**
 * IM 平台的「去哪拿凭证」直达链接。
 *
 * 飞书 / 企业微信**没有扫码绑定**——它们要的是开发者后台里创建应用后拿到的
 * App ID / App Secret / BotID / Secret（代码已核实：两个 provider 包里
 * 扫码相关关键词零命中）。所以这两家不可能有二维码，那不是缺功能。
 *
 * 能改善的是另一件事：面板与聊天卡里「飞书开放平台」「企业微信管理后台」
 * 一直是**纯文字**，用户得自己去搜。这跟 QQ 那个「多跳一次浏览器」是同类缺口。
 */
export type ConsolePlatform = 'feishu' | 'wecom'

/** 飞书有国内 / 国际两套域名，链接必须跟着表单里选的区域走，否则会把人送到登不进去的站点。 */
export type FeishuRegion = 'feishu' | 'lark'

export interface ConsoleLink {
  /** 按钮文案 */
  label: string
  url: string
  /** 到了那儿要做什么、拿什么回来 */
  what: string
}

export function consoleLink(platform: ConsolePlatform, region: FeishuRegion = 'feishu'): ConsoleLink {
  if (platform === 'feishu') {
    const lark = region === 'lark'
    return {
      label: lark ? '打开 Lark 开放平台 →' : '打开飞书开放平台 →',
      url: lark ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app',
      what: '建「自建应用」→ 开长连接 + im:message 权限 + 订阅 im.message.receive_v1，回来填 App ID / App Secret',
    }
  }
  return {
    label: '打开企业微信管理后台 →',
    url: 'https://work.weixin.qq.com/wework_admin/frame',
    what: '建「智能机器人」→ API 接收模式选**长连接**，回来填 BotID / Secret（不是回调模式的 Token/AESKey）',
  }
}
