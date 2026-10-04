/** Bit-exact port of java.util.Random (48-bit LCG), as used by the golden harness. */
const MULT = 0x5deece66dn
const MASK = (1n << 48n) - 1n

export class JavaRandom {
  private seed: bigint

  constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ MULT) & MASK
  }

  next(bits: number): number {
    this.seed = (this.seed * MULT + 0xbn) & MASK
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)))
  }

  nextDouble(): number {
    return (this.next(26) * 2 ** 27 + this.next(27)) * 2 ** -53
  }
}
