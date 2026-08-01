import type { ProfilePrefs } from '../settings/prefs'

/** 用户头像字形:优先 avatar(emoji/字符)首个 code point,否则昵称首字符,再否则 '我'。 */
export function userAvatarGlyph(profile: ProfilePrefs): string {
  const a = profile.avatar.trim()
  if (a) return [...a][0]
  const n = profile.name.trim()
  if (n) return [...n][0]
  return '我'
}

/**
 * 侧栏账户行的头像字形是否与整个昵称重复 —— 重复时该改用通用用户图标。
 *
 * 触发条件是**默认状态**:DEFAULT_PREFS 是 name='我' + avatar='',字形回落到昵称首字,
 * 于是账户行渲染成「我 我」。头像旁边紧挨着一模一样的字,读起来像个 bug。
 * 只在两者完全相同时才让位,一旦用户设了昵称或 emoji 就恢复正常字形。
 */
export function accountGlyphDuplicatesName(profile: ProfilePrefs, displayName: string): boolean {
  return userAvatarGlyph(profile) === displayName.trim()
}
