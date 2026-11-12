// Content and host types for the simulation. Nothing here touches the DOM.

import type { Core, GameAction, Particle, SimObject, Simulation } from "./engine.ts"

export type ObjectKind = "resource" | "stat" | "upgrade" | "equipment" | "core"

/** Objects a value/reveal function may read, keyed by the name it declared ("self" is always present). */
export type Dependencies = Record<string, SimObject>

/** How the display should render a number. */
export interface NumberFormat {
	style : "number" | "energy" | "percent" | "multiplier" | "rate" | "seconds"
	digits? : number
	units? : string
}

export interface CostFormula {
	base : number
	add? : number
	multiplier? : number
}

/** A fixed amount, a per-level table (extrapolated past its end), a formula, or a function of level. */
export type CostEntry = number | number[] | CostFormula | ((level : number) => number)
export type CostTable = Record<string, CostEntry>

export interface ObjectDefinition {
	kind : ObjectKind
	name : string
	displayName? : string
	description? : string
	format? : NumberFormat
	value? : number
	seen? : boolean
	/** Highest level an action can reach. */
	max? : number
	/** Names of objects the functions below read. A leading underscore means "this core's own": `_Rods` on a stat of core alpha is `alphaRods`. */
	dependencies? : string[]
	valueFunction? : (dependencies : Dependencies, self : SimObject) => number
	/** Reveal when this returns true... */
	revealWhen? : (dependencies : Dependencies, self : SimObject) => boolean
	/** ...or when every listed object holds at least the listed amount. */
	revealAt? : Record<string, number>
	/** Must be held, but is not spent. */
	requirements? : CostTable
	cost? : CostTable
	/** Runs after a successful purchase. */
	action? : (simulation : Simulation, self : GameAction) => void
}

export interface CoreDefinition {
	name : string
	displayName : string
	/** Direction of the core's rail from the centre, in radians. */
	angle : number
	/** Starting mass. */
	value : number
	color : string
}

/** Numbers the engine itself uses. Everything an upgrade can change is a stat in the content instead. */
export interface Tuning {
	/** Fixed simulation step. All game speed is expressed as more or fewer of these. */
	tickMs : number
	railMin : number
	railMax : number
	railStart : number
	/** Energy per unit of mass × yield × speed × distance flown. */
	energyScale : number
	/** Emissions a reflector survives. */
	reflectorLife : number
	/** Emissions one dose of poison absorbs. */
	poisonDose : number
	/** Seconds of banked time earned per second away. */
	timeBankRate : number
	timeBankCapSeconds : number
	autoSaveTicks : number
}

export interface GameContent {
	tuning : Tuning
	resources : ObjectDefinition[]
	/** Templates instantiated once per core as `<core><Name>`. */
	coreResources : ObjectDefinition[]
	cores : CoreDefinition[]
}

export interface SaveStorage {
	get(slot : string) : string | undefined
	set(slot : string, value : string) : void
}

/** Everything the simulation needs from the outside world. */
export interface SimulationHost {
	/** Uniform in [0, 1). The only source of randomness the sim uses. */
	random() : number
	/** Wall clock in milliseconds since the epoch. */
	now() : number
	storage : SaveStorage
	log?(message : string) : void
}

export interface SimulationOptions {
	autoSaveSlot? : string
	listener? : SimulationListener
}

/** What the display hears from the sim. Every method is optional and none may change sim state. */
export interface SimulationListener {
	/** The object set was rebuilt (new game, load). Every object reference held by the display is stale. */
	worldRebuilt?(simulation : Simulation) : void
	particleSpawned?(particle : Particle, manual : boolean) : void
	particleLanded?(particle : Particle) : void
	/** A dose of poison absorbed an emission. */
	emissionAbsorbed?(core : Core) : void
	equipmentBroke?(core : Core, equipment : GameAction) : void
	notification?(kind : string, header : string, text : string) : void
}

export const saveVersion = 4

export interface SaveData {
	version : number
	time : number
	objects : Record<string, Record<string, number | boolean>>
}
