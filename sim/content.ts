// Game content: what exists, what it costs, what it does, and the story told along the way.
// The engine (engine.ts) knows the rules of motion; the numbers and the words live here.
//
// Copy rule: an item's description says what it does and stops. Explanations of
// how the pool works belong in `notes`, which the player collects in the notebook.

import type { Dependencies, GameContent, NoteDefinition, ObjectDefinition, StoryBeat } from "./definitions.ts"
import type { SimObject, Simulation } from "./engine.ts"

// --- reactivity ---

/** Emissions per second two cores would cause in each other at zero distance. */
const couplingStrength = 3
/** Distance over which that influence falls by a factor of e, before any refinement. */
const baseCouplingRange = 22
/** Emissions per second a reflector adds, wherever the core sits. */
const reflectorRate = 1.5
/** Emissions per second from a startup source; control rods do not reduce it. */
const sourceRate = 0.25
/** Share of reactivity fully inserted control rods remove. */
const rodStrength = 0.9
/** Emissions one dose of poison absorbs. */
const poisonDose = 25

const coreNames = ["alpha", "beta", "gamma"]

function moreThan(threshold : number) {
	return (dependencies : Dependencies) => dependencies.self.value > threshold
}

/** How strongly the other cores stir this one up: falls off with distance to each. */
function couplingOf(self : SimObject, couplingRange : number) : number {
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
	name : "pale",
	displayName : "Pale",
	format : { style : "number", digits : 1 },
	revealWhen : moreThan(0),
},{
	kind : "resource",
	name : "timeBank",
	displayName : "Banked time",
	format : { style : "seconds" },
	revealWhen : moreThan(0),
},{
	kind : "resource",
	name : "shifts",
	displayName : "Shifts worked",
	format : { style : "number", digits : 0 },
	revealWhen : moreThan(0),
	permanent : true,
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
	name : "injectionMass",
	displayName : "Mass per shot",
	format : { style : "number", digits : 0 },
	value : 1,
	dependencies : ["emissionMass", "tunedInjectors"],
	valueFunction : dependencies => dependencies.emissionMass.value * 3 ** dependencies.tunedInjectors.value,
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
	name : "couplingRange",
	displayName : "Reach",
	format : { style : "number", digits : 0 },
	value : baseCouplingRange,
	dependencies : ["resonance"],
	valueFunction : dependencies => baseCouplingRange * 1.2 ** dependencies.resonance.value,
},{
	kind : "stat",
	name : "energyBonus",
	displayName : "Shift bonus",
	format : { style : "multiplier", digits : 0 },
	value : 1,
	dependencies : ["shifts"],
	valueFunction : dependencies => 2 ** dependencies.shifts.value,
	revealWhen : moreThan(1),
},{
	kind : "stat",
	name : "paleGain",
	displayName : "Pale gain",
	format : { style : "multiplier", digits : 0 },
	value : 1,
	dependencies : ["deepWell"],
	valueFunction : dependencies => 2 ** dependencies.deepWell.value,
},{
	kind : "stat",
	name : "totalMass",
	displayName : "Total mass",
	format : { style : "number", digits : 1 },
	seen : true,
	dependencies : coreNames,
	valueFunction : (_dependencies, self) => self.simulation.cores.reduce((total, core) => total + core.fullMass, 0),
},{
	// How close the three cores are to weighing the same: lightest over heaviest.
	kind : "stat",
	name : "accord",
	displayName : "Accord",
	format : { style : "percent", digits : 0 },
	dependencies : coreNames,
	revealAfter : "wellRepair",
	valueFunction : (_dependencies, self) => {
		const masses = self.simulation.cores.map(core => core.fullMass)
		const heaviest = Math.max(...masses)
		return heaviest > 0 ? Math.min(...masses) / heaviest : 0
	},
},{

	// --- repairs: bringing the station back, one system at a time ---

	kind : "repair",
	name : "lightsRepair",
	displayName : "Lighting",
	description : "Bring the lights up.",
	seen : true,
	cost : { energy : 3 },
	max : 1,
},{
	kind : "repair",
	name : "railRepair",
	displayName : "Rail motors",
	description : "Lets the cores move along their rails.",
	revealAfter : "lightsRepair",
	cost : { energy : 12 },
	max : 1,
},{
	kind : "repair",
	name : "instrumentsRepair",
	displayName : "Instruments",
	description : "Readings for each core and for the pool.",
	revealAfter : "railRepair",
	cost : { energy : 30 },
	max : 1,
},{
	kind : "repair",
	name : "workshopRepair",
	displayName : "Workshop",
	description : "Builds upgrades for the pool.",
	revealAfter : "instrumentsRepair",
	cost : { energy : 60 },
	max : 1,
},{
	kind : "repair",
	name : "storesRepair",
	displayName : "Stores",
	description : "Equipment to fit to each core.",
	revealAfter : "workshopRepair",
	cost : { energy : 250 },
	max : 1,
},{
	kind : "repair",
	name : "wellRepair",
	displayName : "Centre well",
	description : "Drain the well at the centre of the pool.",
	revealAfter : "storesRepair",
	requirements : { totalMass : 300 },
	cost : { energy : 60e3 },
	max : 1,
},{
	kind : "repair",
	name : "doorRepair",
	displayName : "The door marked ONE",
	description : "Open it.",
	revealAfter : "wellRepair",
	cost : { energy : 2e7, pale : 1200 },
	max : 1,
},{

	// --- upgrades (workshop) ---

	kind : "upgrade",
	name : "amplifier",
	displayName : "Yield amplifier",
	description : "Particles deliver 50% more mass and energy.",
	revealAfter : "workshopRepair",
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
	description : "Particles fly 25% faster.",
	revealAfter : "workshopRepair",
	cost : {
		energy : { base : 60, multiplier : 5 },
	},
},{
	kind : "upgrade",
	name : "massDriver",
	displayName : "Mass driver",
	description : "Every emission carries twice the mass.",
	revealAfter : "workshopRepair",
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
	revealAfter : "workshopRepair",
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
	displayName : "Rail gearing",
	description : "Cores travel their rails 60% faster.",
	revealAfter : "workshopRepair",
	cost : {
		energy : { base : 30, multiplier : 5 },
	},
	max : 4,
},{

	// --- refinements: paid for in Pale ---

	kind : "refinement",
	name : "tunedInjectors",
	displayName : "Tuned injectors",
	description : "Shots fired by hand knock out three times the mass.",
	revealAfter : "wellRepair",
	cost : {
		pale : { base : 15, multiplier : 4 },
	},
	max : 4,
},{
	kind : "refinement",
	name : "resonance",
	displayName : "Resonance",
	description : "Cores stir each other from 20% further away.",
	revealAfter : "wellRepair",
	cost : {
		pale : { base : 25, multiplier : 3 },
	},
	max : 5,
},{
	kind : "refinement",
	name : "deepWell",
	displayName : "Deep well",
	description : "Twice as much Pale settles.",
	revealAfter : "wellRepair",
	cost : {
		pale : { base : 40, multiplier : 5 },
	},
	max : 4,
}]

const perCoreObjects : ObjectDefinition[] = [{
	kind : "stat",
	name : "emissionRate",
	displayName : "Emissions",
	format : { style : "rate", digits : 2 },
	seen : true,
	dependencies : [...coreNames, "couplingRange", "_Reflector", "_Rods", "_RodInsertion", "_Source"],
	valueFunction : (dependencies, self) => {
		const reflector = dependencies._Reflector.value > 0 ? reflectorRate : 0
		const rodInsertion = dependencies._Rods.value > 0 ? dependencies._RodInsertion.value : 0
		const source = dependencies._Source.value > 0 ? sourceRate : 0

		return (couplingStrength * couplingOf(self, dependencies.couplingRange.value) + reflector) * (1 - rodStrength * rodInsertion) + source
	},
},{
	kind : "equipment",
	name : "source",
	displayName : "Startup source",
	description : "A steady trickle of emissions at any distance.",
	revealAfter : "storesRepair",
	cost : { energy : 40 },
	max : 1,
},{
	kind : "equipment",
	name : "reflector",
	displayName : "Reflector",
	description : "Many more emissions at any distance. Wears out.",
	revealAfter : "storesRepair",
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
	description : `Absorbs the core's next ${poisonDose} emissions.`,
	revealAfter : "storesRepair",
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
	description : `Cuts the core's reactivity by up to ${rodStrength * 100}%.`,
	revealAfter : "storesRepair",
	cost : { energy : 200 },
	max : 1,
},{
	kind : "resource",
	name : "rodInsertion",
	displayName : "Rod insertion",
	format : { style : "percent", digits : 0 },
}]

// --- the story ---
//
// Each beat is one thing to do. Finishing it files a page in the logbook. Most
// pages are notes left by Marit, who ran the pool before; a few are the plant's
// own records.

function valueOf(simulation : Simulation, name : string) : number {
	return simulation.object(name).value
}

const story : StoryBeat[] = [{
	id : "firstShot",
	objective : "Fire a particle into a core.",
	isDone : simulation => valueOf(simulation, "manualEmissions") >= 1,
	entry : {
		title : "Taped to the injector console",
		voice : "notes",
		body : "If you are reading this, the pool kept. Good.\n\nThe injectors run off a hand crank until you get power back. Fire into a core and it throws a piece of itself at the next one round. That piece is where the power comes from. Do not ask me why yet.\n\nDo not trust the labels on anything.\n\nM.",
	},
},{
	id : "lights",
	objective : "Bring the lights up.",
	isDone : simulation => simulation.has("lightsRepair"),
	entry : {
		title : "Plant record",
		voice : "plant",
		body : "POOL THREE. Lighting restored.\nNights since last entry: 4,380.\nOperator of record: none.\nRail motors: no power. Instruments: no power.",
	},
},{
	id : "rails",
	objective : "Get the rail motors turning.",
	isDone : simulation => simulation.has("railRepair"),
	entry : {
		title : "Pinned above the rail controls",
		voice : "notes",
		body : "We keep them at the far ends of the rails overnight. Out there they are almost asleep.\n\nBring two of them close and they start throwing pieces at each other without being asked. They do not like being near each other. Or they like it too much. I never settled which.\n\nM.",
	},
},{
	id : "restless",
	objective : "Move the cores close enough that they fire on their own.",
	isDone : simulation => valueOf(simulation, "autoEmissions") >= 40,
	entry : {
		title : "Inside the lid of the sample case",
		voice : "notes",
		body : "The catalogue numbers gave Odile headaches, so we named them for their colours. Marigold. Carmine. Verdigris.\n\nAll three came up the same borehole, a few metres apart, and all three were warm. Nobody upstairs would say what the borehole was for.\n\nM.",
	},
},{
	id : "instruments",
	objective : "Bring the instruments back.",
	isDone : simulation => simulation.has("instrumentsRepair"),
	entry : {
		title : "Written on the back of a calibration sheet",
		voice : "notes",
		body : "Count what leaves one core. Count what arrives at the next. For the first year those two numbers matched to the last decimal, every night, and I slept fine.\n\nM.",
	},
},{
	id : "workshop",
	objective : "Reopen the workshop.",
	isDone : simulation => simulation.has("workshopRepair"),
	entry : {
		title : "Chalked on the workshop door",
		voice : "notes",
		body : "Everything in here was built for this pool. The amplifier housings fit the cores to the millimetre.\n\nThe drawings are dated two years before the cores came up the borehole.\n\nM.",
	},
},{
	id : "amplifier",
	objective : "Fit a yield amplifier.",
	isDone : simulation => valueOf(simulation, "amplifier") >= 1,
	entry : {
		title : "Night 412",
		voice : "notes",
		body : "More arrives than left.\n\nI weighed the sender four times. It lost what it lost. The receiver gained that and more. The extra is not coming from the sender and it is not coming from us.\n\nOdile says to stop weighing things and go home.\n\nM.",
	},
},{
	id : "stores",
	objective : "Unlock the stores.",
	isDone : simulation => simulation.has("storesRepair"),
	entry : {
		title : "Stores list, unsigned",
		voice : "notes",
		body : "Reflectors wear out. Poison burns off. Rods are forever.\n\nOrder more of the first two.",
	},
},{
	id : "heavy",
	objective : "Grow the pool to 300 total mass.",
	isDone : simulation => valueOf(simulation, "totalMass") >= 300,
	entry : {
		title : "Night 688",
		voice : "notes",
		body : "They are ten times the size they were and the floor load gauge has not moved.\n\nOdile thinks the pool does not weigh them the way we do. I think the weight is real and it is just not all here yet.\n\nThere is a drain at the centre of the pool floor that is on none of the drawings.\n\nM.",
	},
},{
	id : "well",
	objective : "Drain the centre well.",
	isDone : simulation => simulation.has("wellRepair"),
	entry : {
		title : "Night 701",
		voice : "notes",
		body : "With the well open, something settles in it. It is white and it does not show up on the scales.\n\nIt only comes when all three weigh nearly the same. Let one run ahead of the others and the well stays empty.\n\nWe have been calling it the Pale. I would not touch it.\n\nM.",
	},
},{
	id : "gathering",
	objective : "Gather 150 Pale.",
	// Spending the Pale on the door afterwards must not undo this.
	isDone : simulation => valueOf(simulation, "pale") >= 150 || simulation.has("doorRepair"),
	entry : {
		title : "Night 903",
		voice : "notes",
		body : "I had it backwards. We are not feeding three things. They are passing pieces round until the pieces fit, and the Pale is what is left over each time they do.\n\nThree parts. One shape. I do not know what the shape is for.\n\nThe door at the end of the gantry is marked ONE. I have never had the key. The plant says it will open for enough power and enough Pale.\n\nM.",
	},
},{
	id : "door",
	objective : "Open the door marked ONE.",
	isDone : simulation => simulation.has("doorRepair"),
	entry : {
		title : "Behind the door",
		voice : "notes",
		body : "There is no Pool One. There was never a Pool Two.\n\nThe door opens onto the borehole. Forty metres down it is the same white as the well, all the way across, and it is warm.\n\nMarigold, Carmine and Verdigris are not samples. They are what came loose.\n\nSeal the pool. Go home. Come back tomorrow, because it will want more, and it is better that someone is here.\n\nM.",
	},
}]

// --- the notebook: how things work, filed as the player meets them ---

const notes : NoteDefinition[] = [{
	id : "firing",
	title : "Firing",
	body : "Firing a particle into a core knocks one out towards the next core round the ring. A particle earns energy for as long as it flies: more for more mass, more for more speed, more for a longer flight.",
	isKnown : simulation => valueOf(simulation, "manualEmissions") >= 1,
},{
	id : "rails",
	title : "Rails",
	body : "Cores stir each other up when they are close. Close together they emit often and the flights are short. Far apart they are quiet and each flight is long. Moving one core changes how restless its neighbours are too.",
	isKnown : simulation => simulation.has("railRepair"),
},{
	id : "rest",
	title : "Mass at rest",
	body : "A requirement for mass counts only what is sitting in the core. Mass in flight does not count until it lands. To hold mass in a core, move it away from the others, dose it with poison, or push its control rods in.",
	isKnown : simulation => simulation.has("workshopRepair"),
},{
	id : "yield",
	title : "Yield",
	body : "With an amplifier fitted, a landing adds more mass than the particle carried. The extra shrinks as the receiving core fills up; containment raises how much it can take before that happens.",
	isKnown : simulation => valueOf(simulation, "amplifier") >= 1,
},{
	id : "equipment",
	title : "Equipment",
	body : "Equipment is fitted to one core at a time. A startup source and a reflector make a core emit more wherever it sits; the reflector wears out and has to be replaced. Poison and control rods make it emit less: poison for a fixed number of emissions, rods for as long as they are pushed in.",
	isKnown : simulation => simulation.has("storesRepair"),
},{
	id : "pale",
	title : "Accord and the Pale",
	body : "Accord is how close the three cores are to weighing the same: the lightest as a share of the heaviest. Each landing settles some Pale in the centre well. Heavier particles settle more, and accord matters most of all: at half accord only a quarter as much settles.",
	isKnown : simulation => simulation.has("wellRepair"),
},{
	id : "bank",
	title : "Banked time",
	body : "Time spent away is banked at half rate and spent as double speed.",
	isKnown : simulation => valueOf(simulation, "timeBank") > 0,
},{
	id : "shifts",
	title : "Shifts",
	body : "Sealing the pool ends the shift. The next one starts from a cold pool, and every particle earns twice the energy it did the shift before. The logbook and this notebook are kept.",
	isKnown : simulation => valueOf(simulation, "shifts") >= 1,
}]

export const gameContent : GameContent = {
	tuning : {
		tickMs : 10,
		railMin : 12,
		railMax : 44,
		railStart : 44,
		energyScale : 2e-4,
		reflectorLife : 300,
		poisonDose,
		timeBankRate : 0.5,
		timeBankCapSeconds : 8 * 60 * 60,
		autoSaveTicks : 1000,
		injectionTicks : 14,
		paleScale : 0.05,
	},

	story,
	notes,

	resources : globalObjects,
	coreResources : perCoreObjects,

	// Internal names stay alpha/beta/gamma; the staff named them for their colours.
	cores : [{
		name : "alpha",
		displayName : "Marigold",
		angle : -Math.PI / 2,
		value : 10,
		color : "#ffb53d",
	},{
		name : "beta",
		displayName : "Carmine",
		angle : -Math.PI / 2 + 2 * Math.PI / 3,
		value : 10,
		color : "#ff5c9b",
	},{
		name : "gamma",
		displayName : "Verdigris",
		angle : -Math.PI / 2 + 4 * Math.PI / 3,
		value : 10,
		color : "#8dffc8",
	}],
}
