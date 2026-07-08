/**
 * 分段转写结果按说话顺序 flush。段落带递增 seq(从 0);
 * arrive 存入并从 nextSeq 起连续输出已到达段的非空文本;空串段推进但不产出。
 */
export class OrderedAppender {
  private nextSeq = 0
  private readonly pending = new Map<number, string>()

  arrive(seq: number, text: string): string[] {
    this.pending.set(seq, text)
    const out: string[] = []
    while (this.pending.has(this.nextSeq)) {
      const t = this.pending.get(this.nextSeq) as string
      this.pending.delete(this.nextSeq)
      this.nextSeq++
      if (t) out.push(t)   // 空段:跳过,不产出
    }
    return out
  }
}
