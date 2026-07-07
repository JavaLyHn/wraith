/**
 * 语音听写波形的纯计算逻辑(可测,不依赖 DOM/音频 API)。
 * VoiceBars 组件在 rAF 循环里调用它们,把返回的高度直写到竖条 style。
 */

const MIN_H = 0.1

/** 时域采样(0-255,中心 128)→ RMS 音量 [0,1]。空数组返 0。 */
export function micLevel(timeData: Uint8Array): number {
  if (timeData.length === 0) return 0
  let sum = 0
  for (let i = 0; i < timeData.length; i++) {
    const d = (timeData[i] - 128) / 128
    sum += d * d
  }
  return Math.min(1, Math.sqrt(sum / timeData.length))
}

/**
 * 行波竖条高度:正弦沿竖条空间偏移(i*spacing)+ 随 phase 推进 = 流动的「海浪」;
 * 振幅随 level 增大(录音越响浪越高),并保留基础流动量。返回 n 个 [0.1,1] 的高度分数。
 */
export function waveBars(level: number, phase: number, n: number): number[] {
  const amp = 0.15 + Math.max(0, Math.min(1, level)) * 0.85
  const spacing = Math.PI / Math.max(1, n - 1)   // 半个波长铺满 n 根
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const wave = 0.5 + 0.5 * Math.sin(phase + i * spacing)
    out.push(Math.max(MIN_H, Math.min(1, 0.2 + amp * wave)))
  }
  return out
}

/** 静止态图案:中间高两侧低的对称柔和竖条,n 个 (0,1]。 */
export function idleBars(n: number): number[] {
  const mid = (n - 1) / 2
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - mid) / (mid || 1)
    out.push(Math.max(0.35, 1 - d * 0.6))
  }
  return out
}
