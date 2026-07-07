import logoDark from '../assets/logo-dark.png'
import logoLight from '../assets/logo-light.png'

/**
 * 主题感知品牌标。
 * 浅色主题 → 深色 logo(logo-dark);深色主题 → 浅色 logo(logo-light)。
 * 纯 CSS 按 <html data-theme> 切换(darkMode selector),随主题即时变化。
 * 两张图都套用传入 className(尺寸等),隐藏的那张 display:none 不占位。
 */
export default function Logo({ className = '' }: { className?: string }): JSX.Element {
  return (
    <>
      <img src={logoDark} alt="Wraith" aria-hidden className={'block dark:hidden ' + className} />
      <img src={logoLight} alt="Wraith" aria-hidden className={'hidden dark:block ' + className} />
    </>
  )
}
