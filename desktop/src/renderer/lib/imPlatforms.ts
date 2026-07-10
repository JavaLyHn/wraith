/**
 * IM 接入平台目录 —— 参照 NousResearch/hermes-agent 的 Messaging Gateway 真实平台清单
 * (IM/聊天子集;名字取 hermes 文档真实值)。
 *
 * QQ(QQBot,hermes 第 17 个接入的平台)= 当前 Wraith 已支持(单聊);其余标「即将支持」占位。
 * 非即时通讯的传输项(Email / SMS / ntfy / Home Assistant / Raft / IRC 等)不在此列。
 * icon 为 emoji 占位(近似;后续可换品牌图标)。
 */

export type ImPlatformStatus = 'available' | 'soon'

export interface ImPlatform {
  id: string
  name: string
  icon: string
  status: ImPlatformStatus
  note?: string
}

export const IM_PLATFORMS: ImPlatform[] = [
  { id: 'qq', name: 'QQ', icon: '🐧', status: 'available', note: '单聊' },
  // 国内
  { id: 'weixin', name: '微信', icon: '💬', status: 'available', note: '扫码' },
  { id: 'wecom', name: '企业微信', icon: '🏢', status: 'available', note: '机器人' },
  { id: 'feishu', name: '飞书 / Lark', icon: '🛰️', status: 'available', note: '机器人' },
  { id: 'dingtalk', name: '钉钉', icon: '📌', status: 'soon' },
  { id: 'yuanbao', name: '元宝', icon: '💎', status: 'soon' },
  // 国际
  { id: 'telegram', name: 'Telegram', icon: '✈️', status: 'soon' },
  { id: 'discord', name: 'Discord', icon: '🎮', status: 'soon' },
  { id: 'slack', name: 'Slack', icon: '💼', status: 'soon' },
  { id: 'whatsapp', name: 'WhatsApp', icon: '🟢', status: 'soon' },
  { id: 'signal', name: 'Signal', icon: '🔒', status: 'soon' },
  { id: 'line', name: 'LINE', icon: '💚', status: 'soon' },
  { id: 'matrix', name: 'Matrix', icon: '🌐', status: 'soon' },
  { id: 'mattermost', name: 'Mattermost', icon: '📮', status: 'soon' },
  { id: 'teams', name: 'Microsoft Teams', icon: '👥', status: 'soon' },
  { id: 'imessage', name: 'iMessage', icon: '💠', status: 'soon' },
  { id: 'googlechat', name: 'Google Chat', icon: '🗨️', status: 'soon' },
]
