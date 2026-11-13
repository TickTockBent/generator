import assert from "node:assert/strict"
import { test } from "node:test"
import { gameContent } from "../sim/index.ts"
import { createTestWorld, fingerprint, placeCores } from "./harness.ts"

const tuning = gameContent.tuning

test("same seed gives the same game; a different seed does not", () => {
	const play = (seed : number) => {
		const world = createTestWorld(seed)
		placeCores(world.simulation, 20)
		world.run(120)
		return fingerprint(world.simulation)
	}

	assert.equal(play(7), play(7))
	assert.notEqual(play(7), play(8))
})

test("the result does not depend on how time is sliced into frames", () => {
	const play = (frameMs : number) => {
		const world = createTestWorld(3)
		placeCores(world.simulation, 18)
		world.run(60, frameMs)
		return fingerprint(world.simulation)
	}

	const tickByTick = play(10)
	assert.equal(play(5), tickByTick)
	assert.equal(play(40), tickByTick)
	assert.equal(play(250), tickByTick)
})

test("with no yield bonus, mass is only moved around, never created or lost", () => {
	const world = createTestWorld(4)
	placeCores(world.simulation, 14)
	world.run(300)

	assert.ok(world.events.landed.length > 100, "expected plenty of emissions this close in")
	const totalMass = world.simulation.cores.reduce((total, core) => total + core.fullMass, 0)
	assert.equal(totalMass, 30)
})

test("cores further apart are less reactive", () => {
	const world = createTestWorld()
	const rateAt = (railPosition : number) => {
		placeCores(world.simulation, railPosition)
		return world.simulation.cores[0].own.emissionRate.value
	}

	const rates = [tuning.railMin, 20, 28, 36, tuning.railMax].map(rateAt)
	for (let rateIndex = 1; rateIndex < rates.length; rateIndex++)
		assert.ok(rates[rateIndex] < rates[rateIndex - 1], `rate should fall with distance: ${rates.join(", ")}`)
})

test("moving one core changes its neighbours' reactivity too", () => {
	const world = createTestWorld()
	const [alpha, beta] = world.simulation.cores
	placeCores(world.simulation, 30)
	const betaRateBefore = beta.own.emissionRate.value

	alpha.setRailTarget(tuning.railMin)
	world.run(30)

	assert.equal(alpha.railPosition, tuning.railMin)
	assert.ok(beta.own.emissionRate.value > betaRateBefore)
})

test("a core travels its rail at rail speed, not instantly", () => {
	const world = createTestWorld()
	const alpha = world.simulation.cores[0]
	const railSpeed = world.simulation.engine.railSpeed.value

	alpha.setRailTarget(tuning.railMin)
	world.run(2)

	assert.ok(Math.abs(alpha.railPosition - (tuning.railStart - 2 * railSpeed)) < 1e-6)
})

test("a particle earns energy in proportion to mass, speed and distance flown", () => {
	const world = createTestWorld()
	const alpha = world.simulation.cores[0]

	assert.ok(alpha.fire())
	assert.equal(world.events.spawned.length, 0, "the injected particle has not arrived yet")
	world.run(tuning.injectionTicks * tuning.tickMs / 1000)
	const particle = world.events.spawned[0]
	assert.equal(particle.manual, true)
	world.run(particle.length / particle.speed + 1)

	const expectedEnergy = tuning.energyScale * particle.mass * particle.yieldFactor * particle.speed * particle.length
	assert.equal(world.events.landed.filter(landed => landed == particle).length, 1)
	assert.ok(Math.abs(particle.energyProduced - expectedEnergy) < expectedEnergy * 1e-9)
})

test("longer flights pay more per particle", () => {
	const averageEnergyAt = (railPosition : number) => {
		const world = createTestWorld(11)
		placeCores(world.simulation, railPosition)
		for (let shot = 0; shot < 9; shot++)
			world.simulation.cores[shot % 3].fire()
		world.run(30)
		const manualShots = world.events.landed.filter(particle => particle.manual)
		return manualShots.reduce((total, particle) => total + particle.energyProduced, 0) / manualShots.length
	}

	assert.ok(averageEnergyAt(tuning.railMax) > 2 * averageEnergyAt(tuning.railMin))
})

test("poison absorbs a core's emissions until it burns off", () => {
	const world = createTestWorld(5)
	const alpha = world.simulation.cores[0]
	placeCores(world.simulation, tuning.railMin)

	alpha.own.poison.buy(true)
	assert.equal(alpha.own.poisonCharges.value, tuning.poisonDose)

	while (alpha.own.poisonCharges.value > 0) {
		world.run(0.01)
		assert.equal(world.events.spawned.filter(particle => particle.origin == alpha).length, 0, "poisoned core must not emit")
	}

	assert.equal(world.events.absorbed.length, tuning.poisonDose)
	world.run(20)
	assert.ok(world.events.spawned.some(particle => particle.origin == alpha), "core emits again once the poison is gone")
})

test("a reflector raises reactivity at any distance, then wears out", () => {
	const world = createTestWorld(6)
	const alpha = world.simulation.cores[0]
	placeCores(world.simulation, tuning.railMax)
	const rateWithout = alpha.own.emissionRate.value

	alpha.own.reflector.buy(true)
	world.simulation.update()
	assert.ok(alpha.own.emissionRate.value > rateWithout + 1)
	assert.equal(alpha.own.reflectorLife.value, tuning.reflectorLife)

	// Keep the core fed so it can keep emitting.
	for (let minute = 0; minute < 30 && world.events.broke.length == 0; minute++) {
		alpha.set(1000)
		world.run(60)
	}

	assert.equal(world.events.broke.length, 1)
	assert.equal(alpha.own.reflector.value, 0)
	assert.ok(Math.abs(alpha.own.emissionRate.value - rateWithout) < 1e-9, "rate returns to normal once the reflector is gone")
	assert.equal(alpha.own.reflector.bought, false, "a worn-out reflector can be bought again")
})

test("control rods dial reactivity down, and do nothing until installed", () => {
	const world = createTestWorld()
	const alpha = world.simulation.cores[0]
	placeCores(world.simulation, 20)
	const openRate = alpha.own.emissionRate.value

	alpha.setRodInsertion(1)
	world.simulation.update()
	assert.equal(alpha.own.emissionRate.value, openRate)

	alpha.own.rods.buy(true)
	alpha.setRodInsertion(1)
	world.simulation.update()
	assert.ok(Math.abs(alpha.own.emissionRate.value - openRate * 0.1) < 1e-9)

	alpha.setRodInsertion(0.5)
	world.simulation.update()
	assert.ok(Math.abs(alpha.own.emissionRate.value - openRate * 0.55) < 1e-9)
})

test("buying checks the price at the moment of purchase and takes exactly the cost", () => {
	const world = createTestWorld()
	const simulation = world.simulation
	const accelerator = simulation.action("accelerator")
	const energy = simulation.resource("energy")

	energy.set(59)
	simulation.update()
	assert.equal(accelerator.buy(), false, "hidden and unaffordable")

	energy.set(100)
	simulation.update()
	assert.equal(accelerator.seen, true)
	energy.set(59)
	assert.equal(accelerator.buy(), false, "energy dropped since the last update")

	energy.set(100)
	assert.equal(accelerator.buy(), true)
	assert.equal(energy.value, 40)
	assert.equal(accelerator.value, 1)
	simulation.update()
	assert.equal(simulation.object("particleSpeed").value, 37.5)
})

test("the yield amplifier needs every core holding its mass at rest", () => {
	const world = createTestWorld()
	const simulation = world.simulation
	const amplifier = simulation.action("amplifier")
	simulation.resource("energy").set(1000)
	simulation.update()

	// Poison keeps spontaneous emissions out of the picture.
	for (const core of simulation.cores)
		core.own.poison.buy(true)

	for (const core of simulation.cores)
		for (let shot = 0; shot < 3; shot++)
			core.fire()
	world.run(0.5)
	assert.equal(amplifier.buy(), false, "each core has 7 at rest and 3 in flight")

	world.run(20)
	assert.equal(amplifier.buy(), true)
})

test("saving and loading restores the game, returns mass in flight, and banks time away", () => {
	const world = createTestWorld(9)
	const simulation = world.simulation
	placeCores(simulation, 16)
	simulation.cores[1].setRailTarget(30)
	simulation.cores[2].own.rods.buy(true)
	simulation.cores[2].setRodInsertion(0.4)
	simulation.resource("energy").set(500)
	simulation.action("accelerator").buy(true)
	world.run(45)
	assert.ok(simulation.particles.size > 0, "expected particles in flight at save time")

	simulation.save("manual")
	const energyAtSave = simulation.resource("energy").value
	const fullMassAtSave = simulation.cores.map(core => core.fullMass)

	const reloaded = createTestWorld(1, new Map([["autoSave", world.slots.get("manual") as string]]), world.clock.nowMs + 2 * 60 * 60 * 1000)
	const reloadedSimulation = reloaded.simulation

	assert.equal(reloadedSimulation.resource("energy").value, energyAtSave)
	assert.equal(reloadedSimulation.action("accelerator").value, 1)
	assert.equal(reloadedSimulation.cores[2].own.rodInsertion.value, 0.4)
	assert.equal(reloadedSimulation.cores[1].railTarget, 30)
	assert.equal(reloadedSimulation.particles.size, 0)
	assert.deepEqual(reloadedSimulation.cores.map(core => core.value), fullMassAtSave)
	assert.equal(reloadedSimulation.resource("timeBank").value, (2 * 60 * 60 - 60) * tuning.timeBankRate)
})

test("banked time runs the game at double speed until it is spent", () => {
	const world = createTestWorld()
	const simulation = world.simulation
	simulation.bankTime(10 / tuning.timeBankRate)
	assert.equal(simulation.resource("timeBank").value, 10)

	world.run(4)
	assert.equal(simulation.totalTicks, 800)
	assert.equal(simulation.speed, 2)

	world.run(10)
	assert.equal(simulation.resource("timeBank").value, 0)
	// 10 s of bank is 1000 extra ticks, give or take one for rounding in the countdown.
	assert.ok(Math.abs(simulation.totalTicks - 2400) <= 1, `ticks: ${simulation.totalTicks}`)
	assert.equal(simulation.speed, 1)
})

test("an unreadable or outdated save starts a new game and says so", () => {
	const unreadable = createTestWorld(1, new Map([["autoSave", "not a save"]]))
	assert.deepEqual(unreadable.events.notifications, ["error"])
	assert.equal(unreadable.simulation.resource("energy").value, 0)

	const outdated = createTestWorld(1, new Map([["autoSave", JSON.stringify({ version : 3, resources : {} })]]))
	assert.deepEqual(outdated.events.notifications, ["error"])
})

test("firing cannot promise more mass than the core holds", () => {
	const world = createTestWorld()
	const alpha = world.simulation.cores[0]
	for (const core of world.simulation.cores)
		core.own.poison.buy(true)

	let accepted = 0
	for (let attempt = 0; attempt < 25; attempt++)
		if (alpha.fire())
			accepted++

	assert.equal(accepted, 10)
	world.run(0.5)
	assert.equal(alpha.value, 0)
	assert.equal(alpha.inFlight, 10)
})

// --- the station, the story, the Pale ---

function coldWorld(seed = 1) {
	return createTestWorld(seed, undefined, Date.UTC(2026, 0, 1), true)
}

test("a new station has dead rails and nothing to buy but the lights", () => {
	const world = coldWorld()
	const simulation = world.simulation
	const alpha = simulation.cores[0]

	alpha.setRailTarget(tuning.railMin)
	world.run(3)
	assert.equal(alpha.railPosition, tuning.railStart)

	const visible = [...simulation.data.values()].filter(object => object.seen && ["repair", "upgrade", "equipment", "refinement"].includes(object.kind)).map(object => object.name)
	assert.deepEqual(visible, ["lightsRepair"])

	simulation.action("lightsRepair").buy(true)
	simulation.action("railRepair").buy(true)
	alpha.setRailTarget(tuning.railMin)
	world.run(3)
	assert.ok(alpha.railPosition < tuning.railStart)
})

test("repairs reveal the next system in order", () => {
	const world = coldWorld()
	const simulation = world.simulation
	const isSeen = (name : string) => simulation.object(name).seen

	assert.equal(isSeen("railRepair"), false)
	simulation.action("lightsRepair").buy(true)
	simulation.update()
	assert.equal(isSeen("railRepair"), true)
	assert.equal(isSeen("amplifier"), false)

	for (const repairName of ["railRepair", "instrumentsRepair", "workshopRepair"])
		simulation.action(repairName).buy(true)
	simulation.update()
	assert.equal(isSeen("amplifier"), true)
	assert.equal(isSeen("alphaReflector"), false)

	simulation.action("storesRepair").buy(true)
	simulation.update()
	assert.equal(isSeen("alphaReflector"), true)
	assert.equal(isSeen("tunedInjectors"), false)
})

test("the story advances one beat at a time and files each page once", () => {
	const world = coldWorld()
	const simulation = world.simulation

	assert.equal(simulation.currentBeat?.id, "firstShot")
	world.run(2)
	assert.equal(world.events.beats.length, 0)

	simulation.cores[0].fire()
	world.run(2)
	assert.deepEqual(world.events.beats.map(event => event.beat.id), ["firstShot"])
	assert.equal(world.events.beats[0].firstTime, true)
	assert.equal(simulation.currentBeat?.id, "lights")
	assert.ok(world.events.notes.includes("firing"))

	// Two beats satisfied in the same second are both completed, in order.
	simulation.action("lightsRepair").buy(true)
	simulation.action("railRepair").buy(true)
	world.run(2)
	assert.deepEqual(world.events.beats.map(event => event.beat.id), ["firstShot", "lights", "rails"])
	assert.equal(simulation.currentBeat?.id, "restless")
})

test("Pale settles only with the well open, and far more when the cores weigh the same", () => {
	const paleAfter = (wellOpen : boolean, masses : number[]) => {
		const world = createTestWorld(13)
		const simulation = world.simulation
		if (wellOpen)
			simulation.action("wellRepair").buy(true)
		simulation.cores.forEach((core, coreIndex) => core.set(masses[coreIndex]))
		simulation.update()
		for (let shot = 0; shot < 12; shot++)
			simulation.cores[shot % 3].fire()
		world.run(15)
		return simulation.resource("pale").value
	}

	assert.equal(paleAfter(false, [100, 100, 100]), 0)
	const balanced = paleAfter(true, [100, 100, 100])
	const lopsided = paleAfter(true, [100, 100, 25])
	assert.ok(balanced > 0)
	assert.ok(lopsided < balanced / 4, `balanced ${balanced}, lopsided ${lopsided}`)
})

test("the next shift starts cold, doubles energy, and keeps the logbook", () => {
	const world = createTestWorld(14)
	const simulation = world.simulation
	simulation.cores[0].fire()
	world.run(3)
	simulation.resource("energy").set(5000)
	simulation.action("accelerator").buy(true)
	const knownBefore = [...simulation.knownEntries]
	assert.ok(knownBefore.length > 0)

	simulation.startNextShift()

	assert.equal(simulation.resource("shifts").value, 1)
	assert.equal(simulation.resource("energy").value, 0)
	assert.equal(simulation.action("accelerator").value, 0)
	assert.equal(simulation.has("lightsRepair"), false)
	assert.equal(simulation.currentBeat?.id, "firstShot")
	assert.deepEqual([...simulation.knownEntries], knownBefore)
	assert.equal(simulation.object("energyBonus").value, 2)

	// A particle now earns exactly twice what its mass, speed and distance would have earned on the first shift.
	simulation.cores[0].fire()
	world.run(6)
	const secondShiftShot = world.events.landed.filter(particle => particle.manual).at(-1)!
	const firstShiftWorth = tuning.energyScale * secondShiftShot.mass * secondShiftShot.yieldFactor * secondShiftShot.speed * secondShiftShot.length
	assert.ok(Math.abs(secondShiftShot.energyProduced / firstShiftWorth - 2) < 1e-9)
	assert.equal(world.events.beats.at(-1)?.firstTime, false)

	// And it survives a save and load.
	simulation.save("autoSave")
	const reloaded = createTestWorld(1, world.slots, world.clock.nowMs, true)
	assert.equal(reloaded.simulation.resource("shifts").value, 1)
	assert.deepEqual([...reloaded.simulation.knownEntries], [...simulation.knownEntries])
})

test("the story can be finished, whatever order the station was restored in", () => {
	const world = coldWorld(15)
	const simulation = world.simulation

	// Everything at once, out of order, with the Pale spent on the door before it was ever "gathered".
	for (const repairName of ["doorRepair", "wellRepair", "storesRepair", "workshopRepair", "instrumentsRepair", "railRepair", "lightsRepair"])
		simulation.action(repairName).buy(true)
	simulation.action("amplifier").buy(true)
	for (const core of simulation.cores)
		core.set(200)
	simulation.resource("autoEmissions").set(100)
	simulation.cores[0].fire()
	world.run(3)

	assert.equal(simulation.currentBeat, undefined)
	assert.deepEqual(world.events.beats.map(event => event.beat.id), simulation.content.story.map(beat => beat.id))
	assert.equal(simulation.knownNotes.has("pale"), true)
})
