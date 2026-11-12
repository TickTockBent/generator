// The reactor pool: cores on their rails, particles in flight, and the effects around them.
// Reads simulation state every frame; changes it only through player commands (drag a core, tap to fire).

import type { Core, Particle, Simulation } from "../sim/index.ts"
import { formatEnergy, formatNumber, mixColors, withAlpha } from "./format.ts"

interface Effect {
	kind : "ring" | "flash" | "text" | "shard"
	x : number
	y : number
	color : string
	ageMs : number
	lifeMs : number
	/** Ring: final radius. Flash: radius. Text: rise distance. */
	size : number
	text? : string
}

interface Drag {
	core : Core
	pointerId : number
	startX : number
	startY : number
	moved : boolean
}

const poolGlowColor = "#59dcff"
const railInk = "rgba(190, 232, 240, 0.5)"
const tapSlopPixels = 7
const maximumEffects = 160

export class ReactorView {
	private readonly canvas : HTMLCanvasElement
	private readonly context : CanvasRenderingContext2D
	private simulation : Simulation
	private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

	private widthPixels = 0
	private heightPixels = 0
	private pixelsPerUnit = 1
	private effects : Effect[] = []
	private drag : Drag | undefined
	private hoveredCore : Core | undefined
	/** Smoothed emissions per second, driving the pool's glow. */
	private activity = 0
	private recentLandings = 0
	private lastFrameMs = 0

	/** Called the first time the player drags a core, and the first time they fire one. */
	onFirstDrag : (() => void) | undefined
	onFirstFire : (() => void) | undefined

	constructor(canvas : HTMLCanvasElement, simulation : Simulation) {
		this.canvas = canvas
		this.context = canvas.getContext("2d") as CanvasRenderingContext2D
		this.simulation = simulation

		new ResizeObserver(() => this.resize()).observe(canvas)
		this.resize()

		canvas.addEventListener("pointerdown", event => this.pointerDown(event))
		canvas.addEventListener("pointermove", event => this.pointerMove(event))
		canvas.addEventListener("pointerup", event => this.pointerUp(event))
		canvas.addEventListener("pointercancel", () => { this.drag = undefined })
		canvas.addEventListener("pointerleave", () => { this.hoveredCore = undefined })
	}

	attach(simulation : Simulation) {
		this.simulation = simulation
		this.effects = []
		this.drag = undefined
		this.hoveredCore = undefined
	}

	// --- simulation events ---

	particleSpawned(particle : Particle) {
		this.addEffect({ kind : "ring", x : particle.origin.x, y : particle.origin.y, color : particle.origin.color, ageMs : 0, lifeMs : 380, size : this.coreRadius(particle.origin) * 1.7 })
	}

	particleLanded(particle : Particle) {
		const target = particle.target
		this.recentLandings++
		this.addEffect({ kind : "flash", x : target.x, y : target.y, color : particle.origin.color, ageMs : 0, lifeMs : 260, size : this.coreRadius(target) * 2.1 })
		this.addEffect({ kind : "ring", x : target.x, y : target.y, color : target.color, ageMs : 0, lifeMs : 620, size : this.coreRadius(target) * 2.6 })

		if (particle.manual || this.simulation.particles.size < 12)
			this.addEffect({ kind : "text", x : target.x, y : target.y - this.coreRadius(target) - 1.5, color : "#eaf6f1", ageMs : 0, lifeMs : 1100, size : 4, text : `+${formatEnergy(particle.energyProduced)}` })
	}

	emissionAbsorbed(core : Core) {
		this.addEffect({ kind : "ring", x : core.x, y : core.y, color : "#0c2733", ageMs : 0, lifeMs : 500, size : this.coreRadius(core) * 1.4 })
	}

	equipmentBroke(core : Core) {
		for (let shardIndex = 0; shardIndex < 10; shardIndex++)
			this.addEffect({ kind : "shard", x : core.x, y : core.y, color : "#f4fbf8", ageMs : 0, lifeMs : 700, size : shardIndex * Math.PI / 5 })
	}

	private addEffect(effect : Effect) {
		if (this.simulation.offline)
			return
		if (this.effects.length >= maximumEffects)
			this.effects.shift()
		this.effects.push(effect)
	}

	// --- geometry ---

	private resize() {
		const bounds = this.canvas.getBoundingClientRect()
		const pixelRatio = window.devicePixelRatio || 1
		this.widthPixels = bounds.width
		this.heightPixels = bounds.height
		this.canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio))
		this.canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio))
		this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
		this.pixelsPerUnit = Math.min(this.widthPixels, this.heightPixels) / (2 * (this.simulation.tuning.railMax + 13))
	}

	/** Centre of the rails, in canvas pixels. Sits a little low so the top core clears the readout. */
	private get centre() : { x : number, y : number } {
		return { x : this.widthPixels / 2, y : this.heightPixels / 2 + this.pixelsPerUnit * 5 }
	}

	private toPixels(worldX : number, worldY : number) : { x : number, y : number } {
		const centre = this.centre
		return { x : centre.x + worldX * this.pixelsPerUnit, y : centre.y + worldY * this.pixelsPerUnit }
	}

	/** Drawn radius of a core in rail units: grows with the logarithm of its mass. */
	private coreRadius(core : Core) : number {
		return Math.min(10, 2 + 0.9 * Math.log2(1 + core.value))
	}

	private coreAt(pixelX : number, pixelY : number) : Core | undefined {
		for (const core of this.simulation.cores) {
			const position = this.toPixels(core.x, core.y)
			const hitRadius = Math.max(26, this.coreRadius(core) * this.pixelsPerUnit + 8)
			if (Math.hypot(pixelX - position.x, pixelY - position.y) <= hitRadius)
				return core
		}
		return undefined
	}

	// --- pointer input ---

	private pointerDown(event : PointerEvent) {
		const core = this.coreAt(event.offsetX, event.offsetY)
		if (!core)
			return

		this.canvas.setPointerCapture(event.pointerId)
		this.drag = { core, pointerId : event.pointerId, startX : event.offsetX, startY : event.offsetY, moved : false }
	}

	private pointerMove(event : PointerEvent) {
		const drag = this.drag

		if (!drag) {
			this.hoveredCore = this.coreAt(event.offsetX, event.offsetY)
			this.canvas.style.cursor = this.hoveredCore ? "grab" : "default"
			return
		}

		if (!drag.moved && Math.hypot(event.offsetX - drag.startX, event.offsetY - drag.startY) > tapSlopPixels) {
			drag.moved = true
			this.onFirstDrag?.()
		}

		if (drag.moved) {
			// Project the pointer onto the core's rail.
			const centre = this.centre
			const worldX = (event.offsetX - centre.x) / this.pixelsPerUnit
			const worldY = (event.offsetY - centre.y) / this.pixelsPerUnit
			drag.core.setRailTarget(worldX * Math.cos(drag.core.angle) + worldY * Math.sin(drag.core.angle))
			this.canvas.style.cursor = "grabbing"
		}
	}

	private pointerUp(event : PointerEvent) {
		const drag = this.drag
		this.drag = undefined
		this.canvas.style.cursor = "grab"

		if (drag && !drag.moved && drag.pointerId == event.pointerId) {
			if (drag.core.fire())
				this.onFirstFire?.()
		}
	}

	// --- drawing ---

	draw(nowMs : number) {
		const elapsedMs = Math.min(100, nowMs - this.lastFrameMs)
		this.lastFrameMs = nowMs

		// Glow follows how much is landing: a quick rise, a slow fade.
		const landingsPerSecond = elapsedMs > 0 ? this.recentLandings * 1000 / elapsedMs : 0
		this.recentLandings = 0
		this.activity += (landingsPerSecond - this.activity) * Math.min(1, elapsedMs / (landingsPerSecond > this.activity ? 400 : 2500))

		const context = this.context
		context.clearRect(0, 0, this.widthPixels, this.heightPixels)

		this.drawPool()
		this.drawRails()
		this.drawCoupling(nowMs)
		this.drawParticles()
		for (const core of this.simulation.cores)
			this.drawCore(core, nowMs)
		this.drawEffects(elapsedMs)
	}

	private drawPool() {
		const context = this.context
		const centre = this.centre
		const reach = Math.hypot(this.widthPixels, this.heightPixels) / 2
		const glow = Math.min(1, Math.log2(1 + this.activity) / 5)

		const water = context.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, reach)
		water.addColorStop(0, mixColors("#0c4860", "#1f86a8", glow))
		water.addColorStop(0.55, mixColors("#07303f", "#0d4f66", glow))
		water.addColorStop(1, "#041a25")
		context.fillStyle = water
		context.fillRect(0, 0, this.widthPixels, this.heightPixels)

		// Depth rings, like the rungs of a pool wall seen from above.
		context.lineWidth = 1
		for (let ringRadius = 8; ringRadius <= this.simulation.tuning.railMax + 24; ringRadius += 8) {
			context.strokeStyle = `rgba(160, 225, 240, ${ringRadius % 16 == 0 ? 0.07 : 0.035})`
			context.beginPath()
			context.arc(centre.x, centre.y, ringRadius * this.pixelsPerUnit, 0, Math.PI * 2)
			context.stroke()
		}
	}

	private drawRails() {
		const context = this.context
		const tuning = this.simulation.tuning
		const gauge = 0.9

		for (const core of this.simulation.cores) {
			const along = { x : Math.cos(core.angle), y : Math.sin(core.angle) }
			const across = { x : -along.y, y : along.x }

			context.strokeStyle = railInk
			context.lineWidth = 1.2
			for (const side of [-1, 1]) {
				const start = this.toPixels(along.x * tuning.railMin + across.x * gauge * side, along.y * tuning.railMin + across.y * gauge * side)
				const end = this.toPixels(along.x * tuning.railMax + across.x * gauge * side, along.y * tuning.railMax + across.y * gauge * side)
				context.beginPath()
				context.moveTo(start.x, start.y)
				context.lineTo(end.x, end.y)
				context.stroke()
			}

			// Sleepers every four units; the end stops are heavier.
			for (let distance = tuning.railMin; distance <= tuning.railMax + 0.01; distance += 4) {
				const isStop = distance == tuning.railMin || distance + 4 > tuning.railMax + 0.01
				const halfWidth = gauge * (isStop ? 2.1 : 1.5)
				const start = this.toPixels(along.x * distance - across.x * halfWidth, along.y * distance - across.y * halfWidth)
				const end = this.toPixels(along.x * distance + across.x * halfWidth, along.y * distance + across.y * halfWidth)
				context.strokeStyle = isStop ? "rgba(210, 240, 245, 0.6)" : "rgba(190, 232, 240, 0.2)"
				context.lineWidth = isStop ? 2 : 1
				context.beginPath()
				context.moveTo(start.x, start.y)
				context.lineTo(end.x, end.y)
				context.stroke()
			}

			// Where the core has been told to go.
			if (core.railTarget != core.railPosition) {
				const marker = this.toPixels(along.x * core.railTarget, along.y * core.railTarget)
				const markerSize = 1.6 * this.pixelsPerUnit
				context.strokeStyle = withAlpha(core.color, 0.9)
				context.lineWidth = 1.5
				context.setLineDash([4, 3])
				context.beginPath()
				context.arc(marker.x, marker.y, markerSize, 0, Math.PI * 2)
				context.stroke()
				context.setLineDash([])
			}
		}
	}

	/** Faint arcs between cores: the closer they are, the more they stir each other up. */
	private drawCoupling(nowMs : number) {
		const context = this.context
		const cores = this.simulation.cores

		context.save()
		context.globalCompositeOperation = "lighter"
		for (let firstIndex = 0; firstIndex < cores.length; firstIndex++) {
			for (let secondIndex = firstIndex + 1; secondIndex < cores.length; secondIndex++) {
				const firstCore = cores[firstIndex]
				const secondCore = cores[secondIndex]
				const strength = Math.exp(-this.simulation.distanceBetween(firstCore, secondCore) / 22)
				if (strength < 0.03)
					continue

				const start = this.toPixels(firstCore.x, firstCore.y)
				const end = this.toPixels(secondCore.x, secondCore.y)
				context.strokeStyle = withAlpha(poolGlowColor, Math.min(0.5, strength * 0.9))
				context.lineWidth = 1 + strength * 5
				context.setLineDash([2 + strength * 10, 9])
				context.lineDashOffset = this.reducedMotion ? 0 : -nowMs / 40
				context.beginPath()
				context.moveTo(start.x, start.y)
				context.lineTo(end.x, end.y)
				context.stroke()
			}
		}
		context.restore()
	}

	private drawParticles() {
		const context = this.context
		const trailSteps = this.reducedMotion ? 0 : 9

		context.save()
		context.globalCompositeOperation = "lighter"
		for (const particle of this.simulation.particles) {
			const progress = particle.travelled / particle.length
			const headRadius = (0.55 + 0.32 * Math.log2(1 + particle.mass)) * this.pixelsPerUnit

			for (let trailIndex = trailSteps; trailIndex >= 1; trailIndex--) {
				const trailDistance = particle.travelled - trailIndex * 1.1
				if (trailDistance <= 0)
					continue
				const trailPoint = particle.pointAt(trailDistance)
				const position = this.toPixels(trailPoint.x, trailPoint.y)
				const fade = 1 - trailIndex / (trailSteps + 1)
				context.fillStyle = mixColors(particle.origin.color, particle.target.color, progress, 0.34 * fade)
				context.beginPath()
				context.arc(position.x, position.y, headRadius * (0.35 + 0.6 * fade), 0, Math.PI * 2)
				context.fill()
			}

			const headPoint = particle.pointAt(particle.travelled)
			const head = this.toPixels(headPoint.x, headPoint.y)
			const glow = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, headRadius * 3)
			glow.addColorStop(0, particle.manual ? "rgba(255,255,255,0.95)" : mixColors(particle.origin.color, "#ffffff", 0.55, 0.9))
			glow.addColorStop(0.35, mixColors(particle.origin.color, particle.target.color, progress, 0.55))
			glow.addColorStop(1, mixColors(particle.origin.color, particle.target.color, progress, 0))
			context.fillStyle = glow
			context.beginPath()
			context.arc(head.x, head.y, headRadius * 3, 0, Math.PI * 2)
			context.fill()
		}
		context.restore()
	}

	private drawCore(core : Core, nowMs : number) {
		const context = this.context
		const own = core.own
		const emissionRate = own.emissionRate.value
		const poisoned = own.poisonCharges.value > 0

		// Restless cores shiver.
		const restlessness = this.reducedMotion || poisoned ? 0 : Math.min(1, emissionRate / 3)
		const shiverX = Math.sin(nowMs / 37 + core.angle * 5) * restlessness * 0.35
		const shiverY = Math.cos(nowMs / 29 + core.angle * 3) * restlessness * 0.35
		const position = this.toPixels(core.x + shiverX, core.y + shiverY)
		const radius = this.coreRadius(core) * this.pixelsPerUnit

		// Halo
		context.save()
		context.globalCompositeOperation = "lighter"
		const halo = context.createRadialGradient(position.x, position.y, radius * 0.6, position.x, position.y, radius * 2.6)
		halo.addColorStop(0, withAlpha(core.color, poisoned ? 0.12 : 0.26 + 0.2 * restlessness))
		halo.addColorStop(1, withAlpha(core.color, 0))
		context.fillStyle = halo
		context.beginPath()
		context.arc(position.x, position.y, radius * 2.6, 0, Math.PI * 2)
		context.fill()
		context.restore()

		// Body
		const body = context.createRadialGradient(position.x - radius * 0.3, position.y - radius * 0.35, radius * 0.1, position.x, position.y, radius)
		body.addColorStop(0, mixColors(core.color, "#ffffff", 0.7))
		body.addColorStop(0.55, core.color)
		body.addColorStop(1, mixColors(core.color, "#04202c", 0.55))
		context.fillStyle = body
		context.beginPath()
		context.arc(position.x, position.y, radius, 0, Math.PI * 2)
		context.fill()

		if (poisoned) {
			context.fillStyle = "rgba(4, 26, 37, 0.55)"
			context.beginPath()
			context.arc(position.x, position.y, radius, 0, Math.PI * 2)
			context.fill()
		}

		if (core == this.hoveredCore || core == this.drag?.core) {
			context.strokeStyle = "rgba(255,255,255,0.85)"
			context.lineWidth = 1.5
			context.beginPath()
			context.arc(position.x, position.y, radius + 3, 0, Math.PI * 2)
			context.stroke()
		}

		// Reflector: a bright collar that shortens as it wears.
		if (own.reflector.value > 0) {
			const lifeFraction = own.reflectorLife.value / this.simulation.tuning.reflectorLife
			context.strokeStyle = "rgba(240, 252, 250, 0.9)"
			context.lineWidth = Math.max(2, 0.5 * this.pixelsPerUnit)
			context.lineCap = "round"
			for (let segmentIndex = 0; segmentIndex < 3; segmentIndex++) {
				const segmentStart = core.angle + Math.PI + segmentIndex * 2 * Math.PI / 3 - Math.PI / 3.6
				context.beginPath()
				context.arc(position.x, position.y, radius + 0.9 * this.pixelsPerUnit, segmentStart, segmentStart + (Math.PI / 1.8) * Math.max(0.06, lifeFraction))
				context.stroke()
			}
			context.lineCap = "butt"
		}

		// Control rods: bars that slide in towards the centre.
		if (own.rods.value > 0) {
			const insertion = own.rodInsertion.value
			context.strokeStyle = "rgba(8, 30, 40, 0.92)"
			context.lineWidth = Math.max(2, 0.45 * this.pixelsPerUnit)
			for (let rodIndex = 0; rodIndex < 6; rodIndex++) {
				const rodAngle = rodIndex * Math.PI / 3 + Math.PI / 6
				const outerRadius = radius + 1.6 * this.pixelsPerUnit
				const innerRadius = outerRadius - (0.5 * this.pixelsPerUnit + insertion * (radius * 0.8 + 1.1 * this.pixelsPerUnit))
				context.beginPath()
				context.moveTo(position.x + Math.cos(rodAngle) * outerRadius, position.y + Math.sin(rodAngle) * outerRadius)
				context.lineTo(position.x + Math.cos(rodAngle) * innerRadius, position.y + Math.sin(rodAngle) * innerRadius)
				context.stroke()
			}
		}

		// Startup source: a spark in a tight orbit.
		if (own.source.value > 0) {
			const orbitAngle = this.reducedMotion ? core.angle : nowMs / 260 + core.angle
			const orbitRadius = radius + 2.4 * this.pixelsPerUnit
			context.fillStyle = "#ffffff"
			context.beginPath()
			context.arc(position.x + Math.cos(orbitAngle) * orbitRadius, position.y + Math.sin(orbitAngle) * orbitRadius, Math.max(1.5, 0.3 * this.pixelsPerUnit), 0, Math.PI * 2)
			context.fill()
		}

		// Mass, on the core itself.
		context.fillStyle = poisoned ? "rgba(235, 246, 241, 0.9)" : "rgba(6, 28, 38, 0.88)"
		context.font = `600 ${Math.max(11, radius * 0.62)}px "Barlow Condensed", sans-serif`
		context.textAlign = "center"
		context.textBaseline = "middle"
		context.fillText(formatNumber(core.value, core.value < 100 ? 1 : 0), position.x, position.y + 1)
	}

	private drawEffects(elapsedMs : number) {
		const context = this.context

		context.save()
		for (const effect of this.effects) {
			effect.ageMs += elapsedMs
			const progress = Math.min(1, effect.ageMs / effect.lifeMs)
			const position = this.toPixels(effect.x, effect.y)

			switch (effect.kind) {
				case "ring": {
					context.globalCompositeOperation = "lighter"
					context.strokeStyle = withAlpha(effect.color, 0.7 * (1 - progress))
					context.lineWidth = 2.5 * (1 - progress) + 0.5
					context.beginPath()
					context.arc(position.x, position.y, effect.size * this.pixelsPerUnit * (0.45 + 0.55 * progress), 0, Math.PI * 2)
					context.stroke()
					break
				}

				case "flash": {
					context.globalCompositeOperation = "lighter"
					const radius = effect.size * this.pixelsPerUnit
					const flash = context.createRadialGradient(position.x, position.y, 0, position.x, position.y, radius)
					flash.addColorStop(0, `rgba(255,255,255,${0.75 * (1 - progress)})`)
					flash.addColorStop(0.4, withAlpha(effect.color, 0.5 * (1 - progress)))
					flash.addColorStop(1, withAlpha(effect.color, 0))
					context.fillStyle = flash
					context.beginPath()
					context.arc(position.x, position.y, radius, 0, Math.PI * 2)
					context.fill()
					break
				}

				case "shard": {
					context.globalCompositeOperation = "lighter"
					const distance = (3 + 9 * progress) * this.pixelsPerUnit
					context.strokeStyle = withAlpha(effect.color, 0.9 * (1 - progress))
					context.lineWidth = 2
					context.beginPath()
					context.moveTo(position.x + Math.cos(effect.size) * distance, position.y + Math.sin(effect.size) * distance)
					context.lineTo(position.x + Math.cos(effect.size) * (distance + 1.6 * this.pixelsPerUnit), position.y + Math.sin(effect.size) * (distance + 1.6 * this.pixelsPerUnit))
					context.stroke()
					break
				}

				case "text": {
					context.globalCompositeOperation = "source-over"
					context.fillStyle = withAlpha(effect.color, progress < 0.6 ? 0.95 : 0.95 * (1 - (progress - 0.6) / 0.4))
					context.font = `500 13px "Barlow Semi Condensed", sans-serif`
					context.textAlign = "center"
					context.textBaseline = "alphabetic"
					context.fillText(effect.text ?? "", position.x, position.y - (this.reducedMotion ? 0 : effect.size * this.pixelsPerUnit * progress))
					break
				}
			}
		}
		context.restore()

		this.effects = this.effects.filter(effect => effect.ageMs < effect.lifeMs)
	}
}
