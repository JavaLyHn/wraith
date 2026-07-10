import type { JSX } from 'react'
import {
  SiQq, SiWechat, SiTelegram, SiDiscord, SiWhatsapp, SiSignal,
  SiLine, SiMatrix, SiMattermost, SiGooglechat, SiImessage,
} from 'react-icons/si'
import { RiSlackFill, RiDingdingFill } from 'react-icons/ri'
import { BsMicrosoftTeams } from 'react-icons/bs'
// 深路径引入避免 barrel 连带 @lobehub/ui(未安装 peer;与 ProviderIcon.tsx 同一模式)
import YuanbaoMono from '@lobehub/icons/es/Yuanbao/components/Mono'
import { Building2, Send } from 'lucide-react'

/**
 * IM 平台真实品牌图标(单色,继承 currentColor,由平台卡的文字色驱动)。
 * 来源:simple-icons 为主,Slack/钉钉走 remix、Teams 走 bootstrap(商标清洗后 si 缺失)、
 * 元宝走 @lobehub/icons。企业微信/飞书在各开源图标集均无品牌标(商标),
 * 用 lucide 语义兜底:企微 Building2、飞书 Send(纸飞机,贴其 logo 意象)。
 * 未映射的平台返回 null,调用方回退 emoji 占位。
 */
export function PlatformIcon({ id, className }: { id: string; className?: string }): JSX.Element | null {
  const cls = className ?? 'h-5 w-5'
  switch (id) {
    case 'qq': return <SiQq className={cls} />
    case 'weixin': return <SiWechat className={cls} />
    case 'wecom': return <Building2 className={cls} strokeWidth={1.5} />
    case 'feishu': return <Send className={cls} strokeWidth={1.5} />
    case 'dingtalk': return <RiDingdingFill className={cls} />
    case 'yuanbao': return <span className={'inline-flex items-center justify-center ' + cls}><YuanbaoMono size={18} /></span>
    case 'telegram': return <SiTelegram className={cls} />
    case 'discord': return <SiDiscord className={cls} />
    case 'slack': return <RiSlackFill className={cls} />
    case 'whatsapp': return <SiWhatsapp className={cls} />
    case 'signal': return <SiSignal className={cls} />
    case 'line': return <SiLine className={cls} />
    case 'matrix': return <SiMatrix className={cls} />
    case 'mattermost': return <SiMattermost className={cls} />
    case 'teams': return <BsMicrosoftTeams className={cls} />
    case 'imessage': return <SiImessage className={cls} />
    case 'googlechat': return <SiGooglechat className={cls} />
    default: return null
  }
}
