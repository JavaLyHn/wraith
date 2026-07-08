export interface VadConfig {
  speechLevel: number   // 判定"有声"的 RMS 阈(0..1)
  silenceHoldMs: number // 触发切段的连续静音时长
  maxSegmentMs: number  // 单段封顶,强切
  minSegmentMs: number  // 太短不切,防碎段
}

export const DEFAULT_VAD: VadConfig = {
  speechLevel: 0.02,
  silenceHoldMs: 700,
  maxSegmentMs: 8000,
  minSegmentMs: 400,
}

export interface VadDecision {
  cut: boolean
  reason: 'silence' | 'maxlen' | null
}

/** 音量帧序列 → 切段决策。纯状态机,不碰 MediaRecorder / DOM。 */
export class VadSegmenter {
  private hasSpeech = false
  private speechMs = 0
  private silenceMs = 0
  private segmentMs = 0
  constructor(private readonly cfg: VadConfig = DEFAULT_VAD) {}

  /** 喂一帧:level 为该帧 RMS(0..1),dtMs 为距上帧毫秒。 */
  feed(level: number, dtMs: number): VadDecision {
    this.segmentMs += dtMs
    if (level >= this.cfg.speechLevel) {
      this.hasSpeech = true
      this.speechMs += dtMs
      this.silenceMs = 0
    } else {
      this.silenceMs += dtMs
    }

    if (this.hasSpeech && this.speechMs >= this.cfg.minSegmentMs) {
      if (this.silenceMs >= this.cfg.silenceHoldMs) return { cut: true, reason: 'silence' }
      if (this.segmentMs >= this.cfg.maxSegmentMs) return { cut: true, reason: 'maxlen' }
    }
    return { cut: false, reason: null }
  }

  reset(): void {
    this.hasSpeech = false
    this.speechMs = 0
    this.silenceMs = 0
    this.segmentMs = 0
  }
}
