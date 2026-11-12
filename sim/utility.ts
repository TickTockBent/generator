// Sim-side helpers. Number formatting lives with the display.

import type { CostTable } from "./definitions.ts"

/** Resolves a cost/requirement table at a given level. Entries that come out as 0 (or NaN) are dropped. */
export function getCurrentCost(costData : CostTable | undefined, level : number) : Record<string, number> {
	const result : Record<string, number> = {}

	if (!costData)
		return result

	for (const [name, entry] of Object.entries(costData)) {
		let currentValue = 0

		if (typeof entry === "number") {
			currentValue = entry
		} else if (Array.isArray(entry)) {
			if (level < entry.length) {
				currentValue = entry[level]
			} else {
				// Past the end of the table: hold the last value if the one before it is 0,
				// otherwise continue the geometric step between the last two.
				const lastTwo = entry.slice(-2)
				if (lastTwo.length == 1 || lastTwo[0] == 0)
					currentValue = lastTwo[lastTwo.length - 1]
				else
					currentValue = lastTwo[0] * (lastTwo[1] / lastTwo[0]) ** (level - entry.length + 2)
			}
		} else if (typeof entry === "function") {
			currentValue = entry(level)
		} else {
			currentValue = entry.base

			if (entry.add)
				currentValue += entry.add * level

			if (entry.multiplier)
				currentValue *= entry.multiplier ** level
		}

		if (currentValue)
			result[name] = currentValue
	}

	return result
}

export function randomRange(random : () => number, lowerBound : number, upperBound : number) : number {
	return lowerBound + (upperBound - lowerBound) * random()
}

/** Mass added per unit of mass landing: `power` for an empty core, falling towards 1 as the core fills. */
export function massCap(power : number, mass : number, step : number) : number {
	return 1 + (power - 1) / (10 ** (mass / step))
}

export function camelJoin(prefix : string, suffix : string) : string {
	return prefix + suffix.substr(0, 1).toUpperCase() + suffix.slice(1)
}

export function compressSave(save : string) : string {
	return btoa(save
		.replace(/"displayed":true/g, `#D`)
		.replace(/"seen":true/g, `#S`)
		.replace(/"value":/g, `#V`))
}

export function decompressSave(save : string) : string {
	if (save.slice(-1) != "}")
		save = atob(save)

	return save
		.replace(/#D/g, `"displayed":true`)
		.replace(/#S/g, `"seen":true`)
		.replace(/#V/g, `"value":`)
}
