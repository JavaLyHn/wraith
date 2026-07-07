import logoDark from '../assets/logo-dark.png'
import logoLight from '../assets/logo-light.png'

/**
 * 主题感知品牌标。
 * 浅色主题 → 深色 logo(logo-dark);深色主题 → 浅色 logo(logo-light)。
 * 纯 CSS 按 <html data-theme> 切换(tokens.css 手写规则,与颜色 token 同机制,
 * 不依赖 Tailwind dark: 变体——后者在 dev 下受 config 热更限制会退回 media/系统色)。
 * 两张图都套用传入 className(尺寸等),隐藏的那张 display:none 不占位。
 */
export default function Logo({ className = '' }: { className?: string }): JSX.Element {
  return (
    <>
      <img src={logoDark} alt="Wraith" aria-hidden className={'brand-logo-dark ' + className} />
      <img src={logoLight} alt="Wraith" aria-hidden className={'brand-logo-light ' + className} />
    </>
  )
}
