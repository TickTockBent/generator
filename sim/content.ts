// Game content: what exists, what it costs and what it does.
// The engine (engine.ts) knows the rules of motion; the numbers live here.

import type { Dependencies, GameContent, ObjectDefinition } from "./definitions.ts"
import type { SimObject } from "./engine.ts"

// --- reactivity ---

/** Emissions per second two cores would cause in each other at zero distance. */
const couplingStrength = 3
/** Distance over which that influence falls by a factor of e. */
const couplingRange = 22
/** Emissions per second a reflector adds, wherever the core sits. */
const reflectorRate = 1.5
/** Emissions per second from a startup source; control rods do not reduce it. */
const sourceRate = 0.25
/** Share of reactivity fully inserted control rods remove. */
const rodStrength = 0.9

const coreNames = ["alpha", "beta", "gamma"]

function moreThan(threshold : number) {
	return (dependencies : Dependencies) => dependencies.self.value > threshold
}

/** How strongly the other cores stir this one up: falls off with distance to each. */
function couplingOf(self : SimObject) : number {
	const simulation = self.simulation
	const ownCore = simulation.core(self.coreDefinition!.name)
	let coupling = 0

	for (const otherCore of simulation.cores)
		if (otherCore != ownCore)
			coupling += Math.exp(-simulation.distanceBetween(ownCore, otherCore) / couplingRange)

	return coupling
}

const globalObjects : ObjectDefinition[] = [{
	kind : "resource",
	name : "energy",
	displayName : "Energy",
	format : { style : "energy" },
	seen : true,
},{
	kind : "resource",
	name : "timeBank",
	displayName : "Banked time",
	description : "Time away, saved up. Spent as double speed.",
	format : { style : "seconds" },
	revealWhen : moreThan(0),
},{
	kind : "resource",
	name : "manualEmissions",
	displayName : "Shots fired by hand",
},{
	kind : "resource",
	name : "autoEmissions",
	displayName : "Spontaneous emissions",
},{

	// --- derived numbers ---

	kind : "stat",
	name : "emissionMass",
	displayName : "Mass per emission",
	format : { style : "number", digits : 0 },
	value : 1,
	dependencies : ["massDriver"],
	valueFunction : dependencies => 2 ** dependencies.massDriver.value,
},{
	kind : "stat",
	name : "yield",
	displayName : "Yield",
	format : { style : "multiplier", digits : 2 },
	value : 1,
	dependencies : ["amplifier"],
	valueFunction : dependencies => 1.5 ** dependencies.amplifier.value,
},{
	kind : "stat",
	name : "particleSpeed",
	displayName : "Particle speed",
	format : { style : "number", digits : 0 },
	value : 30,
	dependencies : ["accelerator"],
	valueFunction : dependencies => 30 * 1.25 ** dependencies.accelerator.value,
},{
	kind : "stat",
	name : "capStep",
	displayName : "Containment",
	format : { style : "number", digits : 0 },
	value : 10,
	dependencies : ["containment"],
	valueFunction : dependencies => 10 * 2 ** dependencies.containment.value,
},{
	kind : "stat",
	name : "railSpeed",
	displayName : "Rail speed",
	format : { style : "number", digits : 1 },
	value : 3,
	dependencies : ["railMotors"],
	valueFunction : dependencies => 3 * 1.6 ** dependencies.railMotors.value,
},{
	kind : "stat",
	name : "totalMass",
	displayName : "Total mass",
	format : { style : "number", digits : 1 },
	seen : true,
	dependencies : coreNames,
	valueFunction : (_dependencies, self) => self.simulation.cores.reduce((total, core) => total + core.fullMass, 0),
},{

	// --- upgrades ---

	kind : "upgrade",
	name : "amplifier",
	displayName : "Yield amplifier",
	description : "Particles deliver 50% more mass and energy. Needs every core holding the listed mass at rest.",
	revealAt : { energy : 8 },
	requirements : {
		alpha : { base : 8, multiplier : 1.5 },
		beta : { base : 8, multiplier : 1.5 },
		gamma : { base : 8, multiplier : 1.5 },
	},
	cost : {
		energy : { base : 25, multiplier : 6 },
	},
},{
	kind : "upgrade",
	name : "accelerator",
	displayName : "Accelerator",
	description : "Particles fly 25% faster. Faster flight earns more and lands sooner.",
	revealAt : { energy : 20 },
	cost : {
		energy : { base : 60, multiplier : 5 },
	},
},{
	kind : "upgrade",
	name : "massDriver",
	displayName : "Mass driver",
	description : "Every emission carries twice the mass.",
	revealAt : { energy : 40 },
	requirements : {
		totalMass : [0, 45, 90, 180, 360],
	},
	cost : {
		energy : { base : 90, multiplier : 8 },
	},
},{
	kind : "upgrade",
	name : "containment",
	displayName : "Containment",
	description : "Cores hold twice as much mass before gains taper off.",
	revealAt : { energy : 60 },
	requirements : {
		totalMass : { base : 40, multiplier : 2 },
	},
	cost : {
		energy : { base : 150, multiplier : 10 },
	},
},{
	kind : "upgrade",
	name : "railMotors",
	displayName : "Rail motors",
	description : "Cores travel their rails 60% faster.",
	revealAt : { energy : 15 },
	cost : {
		energy : { base : 30, multiplier : 5 },
	},
	max : 4,
}]

const perCoreObjects : ObjectDefinition[] = [{
	kind : "stat",
	name : "emissionRate",
	displayName : "Emissions",
	format : { style : "rate", digits : 2 },
	seen : true,
	dependencies : [...coreNames, "_Reflector", "_Rods", "_RodInsertion", "_Source"],
	valueFunction : (dependencies, self) => {
		const reflector = dependencies._Reflector.value > 0 ? reflectorRate : 0
		const rodInsertion = dependencies._Rods.value > 0 ? dependencies._RodInsertion.value : 0
		const source = dependencies._Source.value > 0 ? sourceRate : 0

		return (couplingStrength * couplingOf(self) + reflector) * (1 - rodStrength * rodInsertion) + source
	},
},{
	kind : "equipment",
	name : "source",
	displayName : "Startup source",
	description : "A steady trickle of emissions, however far out the core sits.",
	revealAt : { energy : 10 },
	cost : { energy : 40 },
	max : 1,
},{
	kind : "equipment",
	name : "reflector",
	displayName : "Reflector",
	description : "Throws the core's own particles back at it: many more emissions at any distance. Wears out.",
	revealAt : { energy : 50 },
	cost : { energy : 120 },
	max : 1,
	action : (simulation, self) => {
		self.core!.own.reflectorLife.set(simulation.tuning.reflectorLife)
	},
},{
	kind : "resource",
	name : "reflectorLife",
	displayName : "Reflector life",
},{
	kind : "equipment",
	name : "poison",
	displayName : "Poison dose",
	description : "Absorbs the core's next emissions so it holds its mass. Burns off as it works.",
	revealAt : { energy : 30 },
	cost : { energy : 25 },
	action : (simulation, self) => {
		self.core!.own.poisonCharges.add(simulation.tuning.poisonDose)
	},
},{
	kind : "resource",
	name : "poisonCharges",
	displayName : "Poison left",
},{
	kind : "equipment",
	name : "rods",
	displayName : "Control rods",
	description : "A dial for the core's reactivity. Fully in, it is almost silent.",
	revealAt : { energy : 80 },
	cost : { energy : 200 },
	max : 1,
},{
	kind : "resource",
	name : "rodInsertion",
	displayName : "Rod insertion",
	format : { style : "percent", digits : 0 },
}]

export const gameContent : GameContent = {
	tuning : {
		tickMs : 10,
		railMin : 12,
		railMax : 44,
		railStart : 40,
		energyScale : 2e-4,
		reflectorLife : 300,
		poisonDose : 25,
		timeBankRate : 0.5,
		timeBankCapSeconds : 8 * 60 * 60,
		autoSaveTicks : 1000,
	},

	resources : globalObjects,
	coreResources : perCoreObjects,

	// Placeholder names until the setting is written.
	cores : [{
		name : "alpha",
		displayName : "Alpha",
		angle : -Math.PI / 2,
		value : 10,
		color : "#ffb53d",
	},{
		name : "beta",
		displayName : "Beta",
		angle : -Math.PI / 2 + 2 * Math.PI / 3,
		value : 10,
		color : "#ff5c9b",
	},{
		name : "gamma",
		displayName : "Gamma",
		angle : -Math.PI / 2 + 4 * Math.PI / 3,
		value : 10,
		color : "#8dffc8",
	}],
}
