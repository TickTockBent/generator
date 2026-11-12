// Turning numbers into text.

import type { NumberFormat } from "../sim/index.ts"

const prefixes = ["", "k", "M", "G", "T", "P", "E", "Z", "Y", "R", "Q"]

/** 1234567 → "1.23 M". Values under 1000 keep `digits` decimals. */
export function formatNumber(value : number, digits = 1) : string {
	if (!Number.isFinite(value))
		return String(value)

	const magnitude = Math.abs(value)
	if (magnitude < 1000)
		return value.toFixed(digits)

	const prefixIndex = Math.floor(Math.log10(magnitude) / 3)
	if (prefixIndex >= prefixes.length)
		return value.toExponential(2)

	return `${(value / 1000 ** prefixIndex).toFixed(2)} ${prefixes[prefixIndex]}`
}

/** Energy in joules with an SI prefix: "42.0 J", "1.23 MJ". */
export function formatEnergy(value : number) : string {
	const text = formatNumber(value, value < 100 ? 1 : 0)
	return text.includes(" ") ? `${text}J` : `${text} J`
}

export function formatDuration(totalSeconds : number) : string {
	const wholeSeconds = Math.ceil(totalSeconds)
	const hours = Math.floor(wholeSeconds / 3600)
	const minutes = Math.floor(wholeSeconds % 3600 / 60)
	const seconds = wholeSeconds % 60

	if (hours)
		return `${hours} h ${minutes} min`
	if (minutes)
		return `${minutes} min ${seconds} s`
	return `${seconds} s`
}

export function formatValue(value : number, format : NumberFormat | undefined) : string {
	if (!format)
		return formatNumber(value, 0)

	switch (format.style) {
		case "energy":
			return formatEnergy(value)
		case "percent":
			return `${(value * 100).toFixed(format.digits ?? 0)}%`
		case "multiplier":
			return `×${formatNumber(value, format.digits ?? 2)}`
		case "rate":
			return `${formatNumber(value, format.digits ?? 2)} a second`
		case "seconds":
			return formatDuration(value)
		default:
			return `${formatNumber(value, format.digits ?? 1)}${format.units ? " " + format.units : ""}`
	}
}

/** "#ffb53d" with an alpha → "rgba(255,181,61,0.5)". */
export function withAlpha(hexColor : string, alpha : number) : string {
	const red = parseInt(hexColor.slice(1, 3), 16)
	const green = parseInt(hexColor.slice(3, 5), 16)
	const blue = parseInt(hexColor.slice(5, 7), 16)
	return `rgba(${red},${green},${blue},${alpha})`
}

/** Blend two "#rrggbb" colors; 0 gives the first, 1 the second. */
export function mixColors(firstHex : string, secondHex : string, amount : number, alpha = 1) : string {
	const channel = (offset : number) => {
		const first = parseInt(firstHex.slice(offset, offset + 2), 16)
		const second = parseInt(secondHex.slice(offset, offset + 2), 16)
		return Math.round(first + (second - first) * amount)
	}
	return `rgba(${channel(1)},${channel(3)},${channel(5)},${alpha})`
}
