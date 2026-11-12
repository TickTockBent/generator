// Starts the game in the browser: one simulation, the pool view and the panels.

import { gameContent, Simulation, type SimulationHost } from "../sim/index.ts"
import { Panels } from "./panels.ts"
import { ReactorView } from "./reactorView.ts"

const saveSlot = "generator.save"
const hintDoneKey = "generator.hintDone"
/** Frames longer than this (a hidden tab, a sleeping laptop) are banked instead of simulated. */
const longestFrameMs = 250
const panelRefreshMs = 100

const host : SimulationHost = {
	random : () => Math.random(),
	now : () => Date.now(),
	storage : {
		get : slot => localStorage.getItem(slot) ?? undefined,
		set : (slot, value) => localStorage.setItem(slot, value),
	},
}

let view : ReactorView | undefined
let panels : Panels | undefined
const pendingNotices : string[] = []

function showNotice(text : string) {
	const notices = document.querySelector(".notices")
	if (!notices) {
		pendingNotices.push(text)
		return
	}

	const notice = document.createElement("p")
	notice.className = "notice"
	notice.textContent = text
	notices.append(notice)
	setTimeout(() => notice.remove(), 8000)
}

const simulation = new Simulation(gameContent, host, {
	autoSaveSlot : saveSlot,
	listener : {
		worldRebuilt : rebuilt => {
			view?.attach(rebuilt)
			panels?.rebuild(rebuilt)
		},
		injectionFired : (core, flightSeconds) => view?.injectionFired(core, flightSeconds),
		particleSpawned : particle => view?.particleSpawned(particle),
		particleLanded : particle => view?.particleLanded(particle),
		emissionAbsorbed : core => view?.emissionAbsorbed(core),
		equipmentBroke : (core, equipment) => {
			view?.equipmentBroke(core)
			showNotice(`${core.definition.displayName}'s ${equipment.definition.displayName?.toLowerCase()} has worn out.`)
		},
		notification : (_kind, header, text) => showNotice(`${header}. ${text}`),
	},
})

view = new ReactorView(document.querySelector(".pool-canvas") as HTMLCanvasElement, simulation)
panels = new Panels(document, simulation)
pendingNotices.splice(0).forEach(showNotice)

// A first-run hint that goes away once the player has done both things it describes.
const hint = document.querySelector(".pool-hint") as HTMLElement
const hintProgress = { dragged : false, fired : false }
function advanceHint() {
	if (hintProgress.dragged && hintProgress.fired) {
		hint.hidden = true
		localStorage.setItem(hintDoneKey, "yes")
	} else if (hintProgress.fired) {
		hint.textContent = "Now drag a core along its rail. Closer cores set each other off."
	} else if (hintProgress.dragged) {
		hint.textContent = "Now tap a core to fire a particle into it. That knocks one out towards the next core."
	}
}
if (!localStorage.getItem(hintDoneKey)) {
	hint.textContent = "Tap a core to fire a particle into it. That knocks one out towards the next core, earning energy as it flies."
	hint.hidden = false
	view.onFirstDrag = () => { hintProgress.dragged = true; advanceHint() }
	view.onFirstFire = () => { hintProgress.fired = true; advanceHint() }
}

document.querySelector(".start-over")?.addEventListener("click", () => {
	if (confirm("Start over? This wipes your reactor and everything you have bought.")) {
		simulation.reset()
		simulation.save(saveSlot)
	}
})

document.addEventListener("visibilitychange", () => {
	if (document.hidden)
		simulation.save(saveSlot)
})
window.addEventListener("pagehide", () => simulation.save(saveSlot))

let lastFrameMs = performance.now()
let lastPanelRefreshMs = 0

function frame(nowMs : number) {
	let elapsedMs = nowMs - lastFrameMs
	lastFrameMs = nowMs

	if (elapsedMs > longestFrameMs) {
		simulation.bankTime((elapsedMs - longestFrameMs) / 1000)
		elapsedMs = longestFrameMs
	}

	simulation.advance(elapsedMs)
	view?.draw(nowMs)

	if (nowMs - lastPanelRefreshMs >= panelRefreshMs) {
		lastPanelRefreshMs = nowMs
		panels?.update()
	}

	requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

// For tinkering from the browser console.
Object.assign(window, { generator : simulation })
