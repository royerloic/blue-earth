/**
 * Keeps the frame rate up: watches a smoothed frame time and trades render resolution first,
 * then simulation steps per frame. Recovers slowly when there is headroom.
 */
export class AutoTune {
  pixelRatio: number
  maxSteps = 4
  /** Smoothed frame time (ms). */
  frameMs = 16.7
  private slow = 0
  private fast = 0

  constructor(
    private readonly maxPixelRatio = Math.min(devicePixelRatio, 2),
    private readonly minPixelRatio = 0.6,
    /** Frame budget (ms); 60 fps with a little slack. */
    private readonly budget = 18.5,
  ) {
    this.pixelRatio = maxPixelRatio
  }

  /** Feed the real frame interval (ms); returns true if settings changed. */
  update(intervalMs: number): boolean {
    this.frameMs += (Math.min(intervalMs, 100) - this.frameMs) * 0.05
    if (this.frameMs > this.budget) {
      this.fast = 0
      if ((this.slow += intervalMs) > 1500) {
        this.slow = 0
        return this.degrade()
      }
    } else if (this.frameMs < this.budget * 0.7) {
      this.slow = 0
      if ((this.fast += intervalMs) > 6000) {
        this.fast = 0
        return this.improve()
      }
    } else this.slow = this.fast = 0
    return false
  }

  private degrade(): boolean {
    if (this.pixelRatio > this.minPixelRatio + 1e-3) {
      this.pixelRatio = Math.max(this.minPixelRatio, this.pixelRatio * 0.85)
      return true
    }
    if (this.maxSteps > 1) {
      this.maxSteps--
      return true
    }
    return false
  }

  private improve(): boolean {
    if (this.maxSteps < 4) {
      this.maxSteps++
      return true
    }
    if (this.pixelRatio < this.maxPixelRatio - 1e-3) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio / 0.85)
      return true
    }
    return false
  }
}
