export const SPLASH_FLOOR_MS = 1200
export const SPLASH_CAP_MS = 4000
export const SPLASH_EXIT_MS = 450
export const SPLASH_SIZE = 320

/** 是否可散去 splash:到天花板强制散;或已就绪且过地板。 */
export function shouldDismissSplash(
  elapsedMs: number,
  connected: boolean,
  floorMs: number = SPLASH_FLOOR_MS,
  capMs: number = SPLASH_CAP_MS,
): boolean {
  return elapsedMs >= capMs || (connected && elapsedMs >= floorMs)
}

/** 自包含启动页:透明背景、居中 logo、幽灵浮现入场 + 辉光呼吸 + 散去动画;含 __dismiss 钩子。 */
export function buildSplashHtml(logoDataUri: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100vh;background:transparent;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;-webkit-user-select:none;cursor:default}
  .wrap{animation:ghostIn 900ms cubic-bezier(.22,.61,.36,1) both}
  .wrap img{width:132px;height:132px;display:block;
    filter:drop-shadow(0 0 22px rgba(150,195,255,.55));
    animation:glowPulse 2.6s ease-in-out 900ms infinite}
  body.dismiss .wrap{animation:ghostOut 450ms ease-in both}
  body.dismiss .wrap img{animation:none}
  @keyframes ghostIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes ghostOut{from{opacity:1;transform:none}to{opacity:0;transform:scale(1.15)}}
  @keyframes glowPulse{0%,100%{filter:drop-shadow(0 0 18px rgba(150,195,255,.40))}50%{filter:drop-shadow(0 0 30px rgba(150,195,255,.70))}}
  @media (prefers-reduced-motion: reduce){
    .wrap{animation:fadeIn 500ms ease both}
    .wrap img{animation:none}
    body.dismiss .wrap{animation:fadeOut 300ms ease both}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes fadeOut{from{opacity:1}to{opacity:0}}
  }
  </style></head><body>
  <div class="wrap"><img src="${logoDataUri}" alt=""></div>
  <script>window.__dismiss=function(){document.body.classList.add('dismiss')}</script>
  </body></html>`
}
