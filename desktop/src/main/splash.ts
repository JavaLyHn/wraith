export const SPLASH_FLOOR_MS = 1800
// 天花板现在只是"后端始终连不上时防卡死"的失败保险(30s),不再是常规散场时机——
// 常规散场一律等到 backendConnected(加载真正结束)。这样加载多久,logo+闪烁就陪多久。
export const SPLASH_CAP_MS = 30000
export const SPLASH_EXIT_MS = 550
export const SPLASH_SIZE = 320

/** 是否可散去 splash:常规看 connected(加载结束)且过地板;天花板仅作后端卡死时的失败保险强制散。 */
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
  /* 渐变光泽:以 logo 为 mask,一条明亮渐变光带斜扫过 logo。**循环播放**(infinite):
     加载期间每隔一段就闪一下(斜扫 → 停顿 → 再扫),配合 glowPulse 呼吸辉光,只要 splash 还在
     就一直有闪烁特效,直到散场(body.dismiss 停掉)。 */
  .shine{position:absolute;inset:0;pointer-events:none;opacity:0;
    -webkit-mask:url(${logoDataUri}) center/contain no-repeat;
    mask:url(${logoDataUri}) center/contain no-repeat;
    background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.9) 49%,rgba(180,220,255,.95) 51%,transparent 58%);
    background-size:250% 100%;
    animation:shine 2600ms cubic-bezier(.4,0,.2,1) 700ms infinite}
  body.dismiss .wrap{animation:ghostOut 550ms ease-in both}
  body.dismiss .logo img{animation:none}
  body.dismiss .shine{animation:none;opacity:0}
  @keyframes ghostIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes ghostOut{from{opacity:1;transform:none}to{opacity:0;transform:scale(1.06)}}
  @keyframes glowPulse{0%,100%{filter:drop-shadow(0 0 18px rgba(150,195,255,.40))}50%{filter:drop-shadow(0 0 30px rgba(150,195,255,.70))}}
  @keyframes shine{
    0%{background-position:150% 0;opacity:0}
    4%{opacity:1}
    24%{opacity:1}
    30%{background-position:-60% 0;opacity:0}
    100%{background-position:-60% 0;opacity:0}}
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
