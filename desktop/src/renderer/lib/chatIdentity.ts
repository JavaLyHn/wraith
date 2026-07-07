import type { ProfilePrefs } from '../settings/prefs'

/** 用户头像字形:优先 avatar(emoji/字符)首个 code point,否则昵称首字符,再否则 '我'。 */
export function userAvatarGlyph(profile: ProfilePrefs): string {
  const a = profile.avatar.trim()
  if (a) return [...a][0]
  const n = profile.name.trim()
  if (n) return [...n][0]
  return '我'
}
