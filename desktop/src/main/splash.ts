export const SPLASH_FLOOR_MS = 1800
export const SPLASH_CAP_MS = 4000
export const SPLASH_EXIT_MS = 550
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

/** 自包含启动页:透明背景(透出窗体毛玻璃)、居中 logo、幽灵浮现入场 + 辉光呼吸 + 散去动画;含 __dismiss 钩子。 */
export function buildSplashHtml(logoDataUri: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100vh;background:transparent;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;-webkit-user-select:none;cursor:default}
  .wrap{animation:ghostIn 900ms cubic-bezier(.22,.61,.36,1) both}
  .logo{position:relative;width:148px;height:148px}
  .logo img{width:148px;height:148px;display:block;
    filter:drop-shadow(0 0 26px rgba(150,195,255,.50));
    animation:glowPulse 2.6s ease-in-out 900ms infinite}
  /* 渐变光泽:以 logo 为 mask,一条明亮渐变光带斜扫过 logo 一次(闪一下) */
  .shine{position:absolute;inset:0;pointer-events:none;
    -webkit-mask:url(${logoDataUri}) center/contain no-repeat;
    mask:url(${logoDataUri}) center/contain no-repeat;
    background:linear-gradient(115deg,transparent 34%,rgba(255,255,255,.85) 47%,rgba(175,215,255,.95) 53%,transparent 66%);
    background-size:260% 100%;background-position:165% 0;
    animation:shine 900ms cubic-bezier(.4,0,.2,1) 500ms both}
  body.dismiss .wrap{animation:ghostOut 550ms ease-in both}
  body.dismiss .logo img{animation:none}
  @keyframes ghostIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes ghostOut{from{opacity:1;transform:none}to{opacity:0;transform:scale(1.06)}}
  @keyframes glowPulse{0%,100%{filter:drop-shadow(0 0 18px rgba(150,195,255,.40))}50%{filter:drop-shadow(0 0 30px rgba(150,195,255,.70))}}
  @keyframes shine{from{background-position:165% 0}to{background-position:-70% 0}}
  @media (prefers-reduced-motion: reduce){
    .wrap{animation:fadeIn 500ms ease both}
    .logo img{animation:none}
    .shine{display:none}
    body.dismiss .wrap{animation:fadeOut 300ms ease both}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes fadeOut{from{opacity:1}to{opacity:0}}
  }
  </style></head><body>
  <div class="wrap"><div class="logo"><img src="${logoDataUri}" alt=""><span class="shine"></span></div></div>
  <script>window.__dismiss=function(){document.body.classList.add('dismiss')}</script>
  </body></html>`
}
