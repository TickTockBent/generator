export interface SeededRandom {
	/** Uniform in [0, 1). */
	next() : number
	/** Number of values drawn so far. */
	readonly draws : number
}

/** mulberry32: small, fast, and identical on every platform. */
export function createSeededRandom(seed : number) : SeededRandom {
	let state = seed >>> 0
	let draws = 0

	return {
		next() {
			draws++
			state = (state + 0x6D2B79F5) >>> 0
			let mixed = state
			mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
			mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
			return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
		},
		get draws() {
			return draws
		}
	}
}
