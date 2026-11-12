// Prints how scripted players do under different rail settings. Asserts nothing.
//   node test/balance.ts

import { gameContent, type GameAction, type Simulation } from "../sim/index.ts"
import { createTestWorld, placeCores } from "./harness.ts"

const railPositions = [12, 16, 20, 24, 28, 32, 36, 40, 44]

function formatNumber(value : number) : string {
	return value >= 1000 ? value.toExponential(2) : value.toFixed(1)
}

console.log("Idle for 10 minutes, no purchases (energy, emissions):")
for (const railPosition of railPositions) {
	const world = createTestWorld(21)
	placeCores(world.simulation, railPosition)
	world.run(600)
	const emissionRate = world.simulation.cores[0].own.emissionRate.value
	console.log(`  rail ${String(railPosition).padStart(2)}: ${formatNumber(world.simulation.resource("energy").value).padStart(8)} J, ${String(world.events.landed.length).padStart(5)} emissions, ${emissionRate.toFixed(2)}/s per core`)
}

console.log("\nThree clicks a second for 10 minutes, no purchases:")
for (const railPosition of railPositions) {
	const world = createTestWorld(22)
	placeCores(world.simulation, railPosition)
	for (let second = 0; second < 600; second++) {
		for (const core of world.simulation.cores)
			core.fire()
		world.run(1)
	}
	console.log(`  rail ${String(railPosition).padStart(2)}: ${formatNumber(world.simulation.resource("energy").value).padStart(8)} J`)
}

/** Buys whatever is affordable once a second, cheapest first. Optionally rests cores to meet mass requirements. */
function buyAffordable(simulation : Simulation, skipNames : Set<string>) : string[] {
	const boughtNames : string[] = []
	const actions = [...simulation.data.values()]
		.filter((object) : object is GameAction => (object.kind == "upgrade" || object.kind == "equipment") && !skipNames.has(object.definition.name.replace(/^(alpha|beta|gamma)/, "").toLowerCase()))
		.sort((first, second) => (first.calculatedCost.energy ?? 0) - (second.calculatedCost.energy ?? 0))

	for (const action of actions)
		if (action.buy())
			boughtNames.push(action.name)

	return boughtNames
}

console.log("\nBuyer for 30 minutes at a fixed rail position (no poison, rods left open):")
for (const railPosition of railPositions) {
	const world = createTestWorld(23)
	const simulation = world.simulation
	placeCores(simulation, railPosition)
	const purchases : Array<[number, string]> = []
	for (let second = 0; second < 1800; second++) {
		for (const boughtName of buyAffordable(simulation, new Set(["poison"])))
			purchases.push([second, boughtName])
		world.run(1)
	}
	const levels = ["amplifier", "accelerator", "massDriver", "containment", "railMotors"].map(name => `${name} ${simulation.action(name).value}`).join(", ")
	console.log(`  rail ${String(railPosition).padStart(2)}: ${formatNumber(simulation.resource("energy").changeSpeed).padStart(8)} J/s at the end, total mass ${formatNumber(simulation.object("totalMass").value)}, ${levels}`)
	console.log(`           first purchases: ${purchases.slice(0, 6).map(([second, name]) => `${name}@${second}s`).join(" ")}`)
}

console.log(`\nTuning: ${JSON.stringify(gameContent.tuning)}`)
