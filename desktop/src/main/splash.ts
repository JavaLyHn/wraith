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
