// A scripted operator plays a whole shift from a cold station and reports when each
// story beat was reached. Asserts nothing; it is for judging the pacing.
//   node test/balance.ts [minutes]

import { type GameAction } from "../sim/index.ts"
import { createTestWorld } from "./harness.ts"

const minutesToPlay = Number(process.argv[2] ?? 180)
const world = createTestWorld(31, undefined, Date.UTC(2026, 0, 1), true)
const simulation = world.simulation
const buyableKinds = new Set(["repair", "upgrade", "refinement", "equipment"])

function formatClock(seconds : number) : string {
	return `${String(Math.floor(seconds / 60)).padStart(3)}:${String(seconds % 60).padStart(2, "0")}`
}

let beatsReported = 0
let secondsHolding = 0

for (let second = 0; second < minutesToPlay * 60 && simulation.currentBeat; second++) {
	const actions = [...simulation.data.values()].filter((object) : object is GameAction => buyableKinds.has(object.kind))

	// Buy whatever is affordable, cheapest first. Poison is bought only to settle the pool (below).
	for (const action of actions.filter(candidate => !candidate.name.endsWith("Poison")).sort((first, second) => (first.calculatedCost.energy ?? 0) - (second.calculatedCost.energy ?? 0)))
		action.buy()

	// When something is paid for but waiting on mass at rest, pull the cores apart and hold fire for a while.
	const waitingOnMass = actions.some(action => action.seen && !action.bought && simulation.checkResources(action.calculatedCost) && !simulation.checkResources(action.calculatedRequirements))
	secondsHolding = waitingOnMass ? secondsHolding + 1 : 0
	const holding = waitingOnMass && secondsHolding % 40 < 25

	// Keep the cores level: the heaviest sits closest so it sheds mass fastest.
	const lightestMass = Math.min(...simulation.cores.map(core => core.fullMass))
	for (const core of simulation.cores)
		core.setRailTarget(holding ? simulation.tuning.railMax : 18 + 14 * Math.min(1, lightestMass / core.fullMass) ** 3)

	if (!holding) {
		const heaviest = simulation.cores.reduce((first, second) => first.value >= second.value ? first : second)
		heaviest.fire()
		if (second % 2 == 0)
			heaviest.fire()
	}

	world.run(1)

	for (; beatsReported < world.events.beats.length; beatsReported++) {
		const beat = world.events.beats[beatsReported].beat
		console.log(`${formatClock(second)}  ${beat.objective.padEnd(58)} energy ${simulation.resource("energy").value.toExponential(2)} J, ${simulation.resource("energy").changeSpeed.toExponential(1)} J/s, mass ${simulation.object("totalMass").value.toFixed(0)}, accord ${(simulation.object("accord").value * 100).toFixed(0)}%, pale ${simulation.resource("pale").value.toFixed(0)}`)
	}
}

console.log(simulation.currentBeat ? `\nStopped at ${minutesToPlay} minutes, still on: ${simulation.currentBeat.objective}` : "\nShift complete.")
console.log(`Levels: ${[...simulation.data.values()].filter(object => (object.kind == "upgrade" || object.kind == "refinement") && object.value > 0).map(object => `${object.name} ${object.value}`).join(", ")}`)
