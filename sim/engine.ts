// The simulation. Headless and deterministic: randomness, the clock and storage
// come from the host, and time only moves in fixed ticks.
//
// Grew out of a faithful port of the 2017 engine (see legacy/); the object
// graph, cost tables and save scheme are inherited from it.

import {
	saveVersion,
	type CoreDefinition,
	type Dependencies,
	type GameContent,
	type ObjectDefinition,
	type ObjectKind,
	type SaveData,
	type SimulationHost,
	type SimulationListener,
	type SimulationOptions,
	type Tuning,
} from "./definitions.ts"
import { camelJoin, compressSave, decompressSave, getCurrentCost, massCap, randomRange } from "./utility.ts"

type SavedValue = number | boolean

interface Savable {
	name : string
	defaultValue : SavedValue
	read() : SavedValue
	write(value : SavedValue) : void
}

/** Objects the engine itself reads every tick. The content must define them. */
interface EngineObjects {
	energy : Resource
	timeBank : Resource
	autoEmissions : Resource
	manualEmissions : Resource
	emissionMass : SimObject
	yield : SimObject
	particleSpeed : SimObject
	capStep : SimObject
	railSpeed : SimObject
}

// ------------------------------------------------------------------------------------
// Simulation
// ------------------------------------------------------------------------------------

export class Simulation {
	readonly content : GameContent
	readonly tuning : Tuning
	readonly host : SimulationHost
	readonly listener : SimulationListener
	readonly autoSaveSlot : string | undefined

	/** True while the world is being rebuilt; the display should not animate. */
	offline = true
	/** Ticks run per tick of real time: 2 while banked time is being spent. */
	speed = 1
	totalTicks = 0

	updatesPlanned = new Set<SimObject>()
	particles = new Set<Particle>()
	cores : Core[] = []
	engine! : EngineObjects

	private objects : Map<string, SimObject> | undefined
	private tickRemainderMs = 0
	private ticksSinceSave = 0
	private ticksSinceRateMeasure = 0

	/** The host's random source, safe to pass around. */
	readonly random = () : number => this.host.random()

	constructor(content : GameContent, host : SimulationHost, options : SimulationOptions = {}) {
		this.content = content
		this.tuning = content.tuning
		this.host = host
		this.listener = options.listener ?? {}
		this.autoSaveSlot = options.autoSaveSlot

		if (!this.autoSaveSlot || !this.load(this.autoSaveSlot))
			this.reset()
	}

	// --- object access ---

	get data() : ReadonlyMap<string, SimObject> {
		if (!this.objects)
			throw new Error("Simulation data is being rebuilt")
		return this.objects
	}

	find(name : string) : SimObject | undefined {
		return this.objects?.get(name)
	}

	object(name : string) : SimObject {
		const found = this.find(name)
		if (!found)
			throw new Error(`Unknown simulation object: ${name}`)
		return found
	}

	resource(name : string) : Resource {
		const found = this.object(name)
		if (!(found instanceof Resource))
			throw new Error(`${name} is not a resource`)
		return found
	}

	action(name : string) : GameAction {
		const found = this.object(name)
		if (!(found instanceof GameAction))
			throw new Error(`${name} is not an action`)
		return found
	}

	core(name : string) : Core {
		const found = this.object(name)
		if (!(found instanceof Core))
			throw new Error(`${name} is not a core`)
		return found
	}

	distanceBetween(firstCore : Core, secondCore : Core) : number {
		return Math.hypot(firstCore.x - secondCore.x, firstCore.y - secondCore.y)
	}

	// --- lifecycle ---

	reset(saveData? : SaveData) {
		this.offline = true
		this.speed = 1
		this.totalTicks = 0
		this.tickRemainderMs = 0
		this.ticksSinceSave = 0
		this.ticksSinceRateMeasure = 0

		this.updatesPlanned = new Set()
		this.particles = new Set()

		this.objects = undefined
		this.objects = this.initData()
		this.cores = [...this.objects.values()].filter((object) : object is Core => object instanceof Core)
		this.engine = {
			energy : this.resource("energy"),
			timeBank : this.resource("timeBank"),
			autoEmissions : this.resource("autoEmissions"),
			manualEmissions : this.resource("manualEmissions"),
			emissionMass : this.object("emissionMass"),
			yield : this.object("yield"),
			particleSpeed : this.object("particleSpeed"),
			capStep : this.object("capStep"),
			railSpeed : this.object("railSpeed"),
		}

		if (saveData) {
			for (const object of this.objects.values()) {
				const objectSaveData = saveData.objects[object.name]
				if (objectSaveData)
					object.loadSaveData(objectSaveData)
			}
		}

		this.listener.worldRebuilt?.(this)

		for (const object of this.objects.values())
			this.updatesPlanned.add(object)

		this.update()

		if (saveData && saveData.time)
			this.bankTime((this.host.now() - saveData.time) / 1000 - 60)

		this.offline = false
	}

	private createObject(definition : ObjectDefinition, coreDefinition : CoreDefinition | undefined) : SimObject {
		switch (definition.kind) {
			case "resource":
				return new Resource(definition, this, coreDefinition)

			case "stat":
				return new Stat(definition, this, coreDefinition)

			case "upgrade":
			case "equipment":
				return new GameAction(definition, this, coreDefinition)

			case "core":
				if (!coreDefinition)
					throw new Error(`Core ${definition.name} has no definition`)
				return new Core(definition, this, coreDefinition)
		}
	}

	private initData() : Map<string, SimObject> {
		const result = new Map<string, SimObject>()
		const coreDefinitions = this.content.cores

		interface PendingObject {
			definition : ObjectDefinition
			coreDefinition : CoreDefinition | undefined
		}

		const pendingObjects : PendingObject[] = [
			...this.content.resources.map(definition => ({ definition, coreDefinition : undefined })),
			...coreDefinitions.map(coreDefinition => ({
				definition : {
					kind : "core" as ObjectKind,
					name : coreDefinition.name,
					displayName : coreDefinition.displayName,
					format : { style : "number" as const, digits : 1 },
					value : coreDefinition.value,
					seen : true,
				},
				coreDefinition,
			})),
		]

		for (const templateDefinition of this.content.coreResources) {
			for (const coreDefinition of coreDefinitions) {
				pendingObjects.push({
					definition : { ...templateDefinition, name : camelJoin(coreDefinition.name, templateDefinition.name) },
					coreDefinition,
				})
			}
		}

		for (const { definition, coreDefinition } of pendingObjects)
			result.set(definition.name, this.createObject(definition, coreDefinition))

		// Link each core to its own objects and to the next core in the ring.
		const cores = [...result.values()].filter((object) : object is Core => object instanceof Core)
		cores.forEach((core, coreIndex) => {
			core.linkOwnObjects(result)
			core.next = cores[(coreIndex + 1) % cores.length]
		})

		for (const object of result.values()) {
			const definition = object.definition
			const dependencyNames = [
				...(definition.dependencies || []),
				...Object.keys(definition.revealAt || {}),
				...Object.keys(definition.requirements || {}),
				...Object.keys(definition.cost || {}),
			]
			object.dependencies = { self : object }

			for (const dependencyName of dependencyNames) {
				let targetName = dependencyName
				if (dependencyName[0] == "_")
					targetName = camelJoin(object.coreDefinition ? object.coreDefinition.name : object.name, dependencyName.slice(1))

				const target = result.get(targetName)

				if (!target)
					throw new Error(`Unknown dependency: ${object.name} > ${targetName}`)

				// Two objects that list each other: the later one reads the earlier without subscribing back.
				object.dependencies[dependencyName] = target
				if (!object.dependants.has(target))
					target.dependants.add(object)
			}
		}

		return result
	}

	// --- saving ---

	load(slot : string) : boolean {
		const stored = this.host.storage.get(slot)

		if (!stored)
			return false

		let saveData : SaveData
		try {
			saveData = JSON.parse(decompressSave(stored)) as SaveData
		} catch {
			this.reset()
			this.listener.notification?.("error", "Save unreadable", "The stored game could not be read, so a new one was started.")
			return true
		}

		if (saveData.version != saveVersion) {
			this.reset()
			this.listener.notification?.("error", "Save from another version", "The stored game is from a different version and could not be loaded, so a new one was started.")
		} else {
			this.reset(saveData)
		}

		return true
	}

	save(slot : string) {
		const objects : SaveData["objects"] = {}

		for (const object of this.data.values()) {
			const objectSaveData = object.getSaveData()
			if (Object.keys(objectSaveData).length)
				objects[object.name] = objectSaveData
		}

		const saveData : SaveData = {
			version : saveVersion,
			time : this.host.now(),
			objects,
		}

		this.host.storage.set(slot, compressSave(JSON.stringify(saveData)))
	}

	// --- stepping ---

	/** Runs as many fixed ticks as fit into `elapsedMs` (plus any remainder carried from last time). */
	advance(elapsedMs : number) {
		const tickMs = this.tuning.tickMs
		const timeBank = this.engine.timeBank

		this.tickRemainderMs += elapsedMs

		while (this.tickRemainderMs >= tickMs) {
			this.tickRemainderMs -= tickMs
			this.tick()

			// Banked time is spent as extra ticks, one for one.
			if (timeBank.value > 0) {
				timeBank.add(-tickMs / 1000)
				this.tick()
			}
		}

		this.speed = timeBank.value > 0 ? 2 : 1
	}

	tick() {
		const tickSeconds = this.tuning.tickMs / 1000

		for (const core of this.cores)
			core.moveRail(tickSeconds)

		for (const core of this.cores)
			core.rollEmission(tickSeconds)

		for (const particle of this.particles)
			particle.advance(tickSeconds)

		this.update()
		this.totalTicks++

		const ticksPerSecond = Math.round(1 / tickSeconds)
		if (++this.ticksSinceRateMeasure >= ticksPerSecond) {
			this.ticksSinceRateMeasure = 0
			for (const object of this.data.values())
				object.measureChange(1)
		}

		if (++this.ticksSinceSave >= this.tuning.autoSaveTicks) {
			this.ticksSinceSave = 0
			if (this.autoSaveSlot)
				this.save(this.autoSaveSlot)
		}
	}

	/** Recomputes every object whose inputs changed, until nothing more changes. */
	update() {
		while (this.updatesPlanned.size) {
			for (const object of this.updatesPlanned) {
				this.updatesPlanned.delete(object)
				object.update()
			}
		}
	}

	/** Credits time spent away. Earned at `timeBankRate` and spent as double speed. */
	bankTime(secondsAway : number) {
		if (!(secondsAway > 0))
			return

		const timeBank = this.engine.timeBank
		timeBank.set(Math.min(this.tuning.timeBankCapSeconds, timeBank.value + secondsAway * this.tuning.timeBankRate))
	}

	/** True if every listed object holds at least the listed amount. With `pay`, deducts them (after checking all). */
	checkResources(amounts : Record<string, number> | undefined, pay = false) : boolean {
		if (!amounts)
			return true

		for (const [name, amount] of Object.entries(amounts)) {
			const object = this.find(name)

			if (!object || object.value < amount)
				return false
		}

		if (pay)
			for (const [name, amount] of Object.entries(amounts))
				this.resource(name).add(-amount)

		return true
	}
}

// ------------------------------------------------------------------------------------
// Particles
// ------------------------------------------------------------------------------------

export interface PathPoint {
	x : number
	y : number
}

const pathSegments = 24

export class Particle {
	readonly simulation : Simulation
	readonly origin : Core
	readonly target : Core
	readonly mass : number
	readonly yieldFactor : number
	/** Rail units per second. */
	readonly speed : number
	/** Fired by the player rather than by instability. */
	readonly manual : boolean

	/** The flight path as straight segments; `cumulativeLength[i]` is the distance flown on reaching `points[i]`. */
	readonly points : PathPoint[] = []
	readonly cumulativeLength : number[] = []
	readonly length : number
	travelled = 0
	energyProduced = 0

	private readonly energyPerDistance : number

	constructor(simulation : Simulation, origin : Core, target : Core, mass : number, manual : boolean) {
		this.simulation = simulation
		this.origin = origin
		this.target = target
		this.mass = mass
		this.manual = manual
		this.yieldFactor = simulation.engine.yield.value
		this.speed = simulation.engine.particleSpeed.value

		this.buildPath()
		this.length = this.cumulativeLength[this.cumulativeLength.length - 1]

		// Energy comes from mass in flight: it is earned per unit of distance, and faster particles earn more.
		this.energyPerDistance = simulation.tuning.energyScale * this.mass * this.yieldFactor * this.speed
	}

	/** A cubic Bézier between the two cores with randomly swung handles, so no two flights are the same length. */
	private buildPath() {
		const random = this.simulation.random
		const origin = this.origin
		const target = this.target

		const directDistance = this.simulation.distanceBetween(origin, target)
		const directAngle = Math.atan2(target.y - origin.y, target.x - origin.x)
		const departureAngle = directAngle - randomRange(random, -Math.PI / 10, Math.PI / 2)
		const arrivalAngle = directAngle + randomRange(random, -Math.PI / 10, Math.PI / 2) + Math.PI
		const departureReach = directDistance * randomRange(random, 0.25, 0.7)
		const arrivalReach = directDistance * randomRange(random, 0.25, 0.7)

		const controlPoints : PathPoint[] = [
			{ x : origin.x, y : origin.y },
			{ x : origin.x + Math.cos(departureAngle) * departureReach, y : origin.y + Math.sin(departureAngle) * departureReach },
			{ x : target.x + Math.cos(arrivalAngle) * arrivalReach, y : target.y + Math.sin(arrivalAngle) * arrivalReach },
			{ x : target.x, y : target.y },
		]

		let totalLength = 0
		for (let pointIndex = 0; pointIndex <= pathSegments; pointIndex++) {
			const position = pointIndex / pathSegments
			const remaining = 1 - position
			const point : PathPoint = {
				x : controlPoints[0].x * remaining ** 3 +
					controlPoints[1].x * 3 * position * remaining ** 2 +
					controlPoints[2].x * 3 * remaining * position ** 2 +
					controlPoints[3].x * position ** 3,
				y : controlPoints[0].y * remaining ** 3 +
					controlPoints[1].y * 3 * position * remaining ** 2 +
					controlPoints[2].y * 3 * remaining * position ** 2 +
					controlPoints[3].y * position ** 3,
			}

			if (pointIndex > 0) {
				const previousPoint = this.points[pointIndex - 1]
				totalLength += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
			}

			this.points.push(point)
			this.cumulativeLength.push(totalLength)
		}
	}

	/** Position after flying `distance` along the path. */
	pointAt(distance : number) : PathPoint {
		if (distance <= 0)
			return this.points[0]
		if (distance >= this.length)
			return this.points[this.points.length - 1]

		let segmentIndex = 1
		while (this.cumulativeLength[segmentIndex] < distance)
			segmentIndex++

		const segmentStart = this.cumulativeLength[segmentIndex - 1]
		const segmentLength = this.cumulativeLength[segmentIndex] - segmentStart
		const fraction = segmentLength > 0 ? (distance - segmentStart) / segmentLength : 0
		const startPoint = this.points[segmentIndex - 1]
		const endPoint = this.points[segmentIndex]

		return {
			x : startPoint.x + (endPoint.x - startPoint.x) * fraction,
			y : startPoint.y + (endPoint.y - startPoint.y) * fraction,
		}
	}

	advance(seconds : number) {
		const distanceFlown = Math.min(this.speed * seconds, this.length - this.travelled)
		const energyEarned = this.energyPerDistance * distanceFlown

		this.travelled += distanceFlown
		this.energyProduced += energyEarned
		this.simulation.engine.energy.add(energyEarned)

		if (this.travelled >= this.length - 1e-9)
			this.land()
	}

	private land() {
		this.simulation.particles.delete(this)
		this.origin.inFlight -= this.mass
		this.target.accept(this)
		this.simulation.listener.particleLanded?.(this)
	}
}

// ------------------------------------------------------------------------------------
// Simulation objects
// ------------------------------------------------------------------------------------

export abstract class SimObject {
	readonly definition : ObjectDefinition
	readonly simulation : Simulation
	readonly name : string
	readonly kind : ObjectKind
	/** Set on a core and on everything that belongs to one. */
	readonly coreDefinition : CoreDefinition | undefined

	readonly dependants = new Set<SimObject>()
	dependencies : Dependencies = {}

	seen : boolean
	value : number
	private oldValue : number
	private measuredValue : number
	/** Units per second of simulated time, refreshed once a second. */
	changeSpeed = 0

	protected savables : Savable[] = []

	constructor(definition : ObjectDefinition, simulation : Simulation, coreDefinition : CoreDefinition | undefined) {
		this.definition = definition
		this.simulation = simulation
		this.name = definition.name
		this.kind = definition.kind
		this.coreDefinition = coreDefinition

		this.seen = definition.seen ?? false
		this.value = definition.value ?? 0

		this.addSavable("seen", this.seen, () => this.seen, value => { this.seen = value as boolean })

		this.oldValue = this.value
		this.measuredValue = this.value
	}

	/** The core this object belongs to, if any. */
	get core() : Core | undefined {
		return this.coreDefinition ? this.simulation.core(this.coreDefinition.name) : undefined
	}

	measureChange(seconds : number) {
		this.changeSpeed = (this.value - this.measuredValue) / seconds
		this.measuredValue = this.value
	}

	protected addSavable(name : string, defaultValue : SavedValue, read : () => SavedValue, write : (value : SavedValue) => void) {
		write(defaultValue)
		this.savables.push({ name, defaultValue, read, write })
	}

	getSaveData() : Record<string, SavedValue> {
		const saveData : Record<string, SavedValue> = {}
		for (const savable of this.savables) {
			const currentValue = savable.read()
			if (currentValue != savable.defaultValue)
				saveData[savable.name] = currentValue
		}
		return saveData
	}

	loadSaveData(saveData : Record<string, SavedValue>) {
		for (const savable of this.savables) {
			const savedValue = saveData[savable.name]
			savable.write(savedValue !== undefined ? savedValue : savable.defaultValue)
		}

		this.measuredValue = this.value
		this.changeSpeed = 0

		this.onLoad()
	}

	protected onLoad() {}

	/** Tells everything that reads this object to recompute, for changes that are not a change of `value`. */
	markChanged() {
		for (const dependant of this.dependants)
			this.simulation.updatesPlanned.add(dependant)
	}

	update() {
		const definition = this.definition

		if (definition.valueFunction)
			this.value = definition.valueFunction(this.dependencies, this)

		if (!this.seen && (
			definition.revealWhen && definition.revealWhen(this.dependencies, this) ||
			definition.revealAt && this.simulation.checkResources(definition.revealAt)
		))
			this.seen = true

		if (this.value != this.oldValue)
			this.markChanged()

		this.oldValue = this.value
	}
}

export class Stat extends SimObject {}

export class Resource extends SimObject {
	constructor(definition : ObjectDefinition, simulation : Simulation, coreDefinition : CoreDefinition | undefined) {
		super(definition, simulation, coreDefinition)
		this.addSavable("value", this.value, () => this.value, value => { this.value = value as number })
	}

	add(amount = 1) {
		if (!amount)
			return

		this.value += amount

		if (this.value < 0)
			this.value = 0

		this.simulation.updatesPlanned.add(this)
	}

	set(value = 0) {
		this.add(value - this.value)
	}
}

/** The per-core objects the engine reads. The content's `coreResources` must define them. */
export interface CoreObjects {
	emissionRate : SimObject
	reflector : GameAction
	reflectorLife : Resource
	rods : GameAction
	rodInsertion : Resource
	source : GameAction
	poison : GameAction
	poisonCharges : Resource
}

export class Core extends Resource {
	readonly angle : number
	readonly color : string
	own! : CoreObjects
	/** The core this one shoots at. */
	next! : Core

	/** Distance from the centre along the rail, and where the player has asked it to go. */
	railPosition : number
	railTarget : number
	/** Mass that has left this core and not yet landed; returned to it when a save is loaded. */
	inFlight = 0

	constructor(definition : ObjectDefinition, simulation : Simulation, coreDefinition : CoreDefinition) {
		super(definition, simulation, coreDefinition)
		this.angle = coreDefinition.angle
		this.color = coreDefinition.color
		this.railPosition = simulation.tuning.railStart
		this.railTarget = simulation.tuning.railStart

		this.addSavable("inFlight", 0, () => this.inFlight, value => { this.inFlight = value as number })
		this.addSavable("railPosition", this.railPosition, () => this.railPosition, value => { this.railPosition = value as number })
		this.addSavable("railTarget", this.railTarget, () => this.railTarget, value => { this.railTarget = value as number })
	}

	get x() : number {
		return Math.cos(this.angle) * this.railPosition
	}

	get y() : number {
		return Math.sin(this.angle) * this.railPosition
	}

	/** Mass at rest plus mass in flight. */
	get fullMass() : number {
		return this.value + this.inFlight
	}

	linkOwnObjects(objects : Map<string, SimObject>) {
		const own : Record<string, SimObject | undefined> = {}
		for (const { name } of this.simulation.content.coreResources)
			own[name] = objects.get(camelJoin(this.name, name))
		this.own = own as unknown as CoreObjects
	}

	// --- player commands ---

	/** Ask the core to travel to a rail position; it gets there at rail speed. */
	setRailTarget(position : number) {
		const tuning = this.simulation.tuning
		this.railTarget = Math.min(tuning.railMax, Math.max(tuning.railMin, position))
	}

	/** Set how far the control rods are pushed in, 0 to 1. Does nothing without rods. */
	setRodInsertion(insertion : number) {
		if (this.own.rods.value > 0)
			this.own.rodInsertion.set(Math.min(1, Math.max(0, insertion)))
	}

	/** Fire one particle by hand. */
	fire() : boolean {
		if (!this.shoot(true))
			return false

		this.simulation.engine.manualEmissions.add(1)
		return true
	}

	// --- per tick ---

	moveRail(seconds : number) {
		if (this.railPosition == this.railTarget)
			return

		const step = this.simulation.engine.railSpeed.value * seconds
		const remaining = this.railTarget - this.railPosition
		this.railPosition = Math.abs(remaining) <= step ? this.railTarget : this.railPosition + Math.sign(remaining) * step

		// Position is not `value`, so dependants (every core's emission rate) are told explicitly.
		this.markChanged()
	}

	rollEmission(seconds : number) {
		// Always drawn, so the random sequence does not depend on the state of the core.
		const roll = this.simulation.random()

		if (roll >= this.own.emissionRate.value * seconds)
			return

		if (this.own.poisonCharges.value > 0) {
			this.own.poisonCharges.add(-1)
			this.simulation.listener.emissionAbsorbed?.(this)
			return
		}

		if (!this.shoot(false))
			return

		this.simulation.engine.autoEmissions.add(1)

		if (this.own.reflector.value > 0) {
			this.own.reflectorLife.add(-1)
			if (this.own.reflectorLife.value <= 0) {
				this.own.reflector.set(0)
				this.simulation.listener.equipmentBroke?.(this, this.own.reflector)
			}
		}
	}

	private shoot(manual : boolean) : boolean {
		const simulation = this.simulation
		const mass = simulation.engine.emissionMass.value

		if (this.value < mass)
			return false

		const particle = new Particle(simulation, this, this.next, mass, manual)

		this.add(-mass)
		this.inFlight += mass
		simulation.particles.add(particle)
		simulation.listener.particleSpawned?.(particle, manual)

		return true
	}

	/** A particle lands: each unit of its mass adds `yield` units, damped as this core's mass grows. */
	accept(particle : Particle) {
		const capStep = this.simulation.engine.capStep.value
		let remainingMass = particle.mass
		let newValue = this.value

		while (remainingMass > 1) {
			remainingMass -= 1
			const added = massCap(particle.yieldFactor, newValue, capStep)
			newValue += added
			// Past the cap the gain is negligible; add the rest one for one.
			if (added - 1 < 1e-4) {
				newValue += remainingMass
				remainingMass = 0
			}
		}

		newValue += remainingMass * massCap(particle.yieldFactor, newValue, capStep)

		this.add(newValue - this.value)
	}

	protected override onLoad() {
		this.value += this.inFlight
		this.inFlight = 0
	}
}

export class GameAction extends Resource {
	/** Affordable as of the last update; `buy` re-checks. */
	canAfford = false
	/** At its maximum level. */
	bought = false
	calculatedCost : Record<string, number> = {}
	calculatedRequirements : Record<string, number> = {}

	constructor(definition : ObjectDefinition, simulation : Simulation, coreDefinition : CoreDefinition | undefined) {
		super(definition, simulation, coreDefinition)
		this.calculateCosts()
	}

	get max() : number | undefined {
		return this.definition.max
	}

	private calculateCosts() {
		this.calculatedCost = getCurrentCost(this.definition.cost, this.value)
		this.calculatedRequirements = getCurrentCost(this.definition.requirements, this.value)
		this.bought = this.max !== undefined && this.value >= this.max
		this.simulation.updatesPlanned.add(this)
	}

	private isAffordable() : boolean {
		return this.simulation.checkResources(this.calculatedCost) && this.simulation.checkResources(this.calculatedRequirements)
	}

	override add(amount? : number) {
		super.add(amount)
		this.calculateCosts()
	}

	override update() {
		this.canAfford = this.seen && !this.bought && this.isAffordable()
		super.update()
	}

	/** Buys one level. `free` skips the checks and the payment (tests and scripted setups). */
	buy(free = false) : boolean {
		if (this.bought)
			return false

		if (!free) {
			if (!this.seen || !this.isAffordable())
				return false

			this.simulation.checkResources(this.calculatedCost, true)
		}

		this.add(1)

		if (this.definition.action)
			this.definition.action(this.simulation, this)

		return true
	}

	protected override onLoad() {
		this.calculateCosts()
	}
}
