// Shared test setup: a simulation with seeded randomness, a settable clock and in-memory storage.

import { createSeededRandom, gameContent, Simulation, type Core, type GameAction, type Particle, type SimulationListener } from "../sim/index.ts"

export interface TestWorld {
	simulation : Simulation
	clock : { nowMs : number }
	slots : Map<string, string>
	events : {
		spawned : Particle[]
		landed : Particle[]
		absorbed : Core[]
		broke : GameAction[]
		notifications : string[]
	}
	/** Advance simulated time in frames of `frameMs` (default one tick). */
	run(seconds : number, frameMs? : number) : void
}

export function createTestWorld(seed = 1, existingSlots? : Map<string, string>, startMs = Date.UTC(2026, 0, 1)) : TestWorld {
	const seededRandom = createSeededRandom(seed)
	const clock = { nowMs : startMs }
	const slots = existingSlots ?? new Map<string, string>()
	const events : TestWorld["events"] = { spawned : [], landed : [], absorbed : [], broke : [], notifications : [] }

	const listener : SimulationListener = {
		particleSpawned : particle => { events.spawned.push(particle) },
		particleLanded : particle => { events.landed.push(particle) },
		emissionAbsorbed : core => { events.absorbed.push(core) },
		equipmentBroke : (_core, equipment) => { events.broke.push(equipment) },
		notification : kind => { events.notifications.push(kind) },
	}

	const simulation = new Simulation(gameContent, {
		random : () => seededRandom.next(),
		now : () => clock.nowMs,
		storage : {
			get : slot => slots.get(slot),
			set : (slot, value) => { slots.set(slot, value) },
		},
	}, { autoSaveSlot : "autoSave", listener })

	return {
		simulation, clock, slots, events,
		run(seconds, frameMs = gameContent.tuning.tickMs) {
			const frames = Math.round(seconds * 1000 / frameMs)
			for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
				clock.nowMs += frameMs
				simulation.advance(frameMs)
			}
		},
	}
}

/** Puts every core at one rail position immediately. */
export function placeCores(simulation : Simulation, railPosition : number) {
	for (const core of simulation.cores) {
		core.setRailTarget(railPosition)
		core.railPosition = core.railTarget
		core.markChanged()
	}
	simulation.update()
}

/** Everything that defines the state, as plain data. */
export function fingerprint(simulation : Simulation) : string {
	return JSON.stringify({
		ticks : simulation.totalTicks,
		objects : [...simulation.data.values()].map(object => [object.name, object.value, object.seen]),
		cores : simulation.cores.map(core => [core.railPosition, core.railTarget, core.inFlight]),
		particles : [...simulation.particles].map(particle => [particle.origin.name, particle.mass, particle.travelled, particle.length]),
	})
}
