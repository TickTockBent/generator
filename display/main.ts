// Starts the game in the browser: one simulation, the pool view, the panels and the logbook.

import { gameContent, Simulation, type SimulationHost } from "../sim/index.ts"
import { Logbook } from "./logbook.ts"
import { Panels } from "./panels.ts"
import { ReactorView } from "./reactorView.ts"

const saveSlot = "generator.save"
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

const isNewGame = localStorage.getItem(saveSlot) === null

let view : ReactorView | undefined
let panels : Panels | undefined
let logbook : Logbook | undefined
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

const introCurtain = document.querySelector(".curtain.intro") as HTMLElement
const endingCurtain = document.querySelector(".curtain.ending") as HTMLElement

/** The shift is over once the last beat is done and its page has been read. */
function showEndingIfDue() {
	if (simulation.currentBeat || logbook?.hasWaitingPages)
		return

	const shiftNumber = simulation.resource("shifts").value + 1
	;(endingCurtain.querySelector(".ending-title") as HTMLElement).textContent = `Shift ${shiftNumber} is over`
	endingCurtain.hidden = false
}

const simulation = new Simulation(gameContent, host, {
	autoSaveSlot : saveSlot,
	listener : {
		worldRebuilt : rebuilt => {
			view?.attach(rebuilt)
			panels?.rebuild(rebuilt)
			logbook?.attach(rebuilt)
		},
		injectionFired : (core, flightSeconds) => view?.injectionFired(core, flightSeconds),
		particleSpawned : particle => view?.particleSpawned(particle),
		particleLanded : particle => view?.particleLanded(particle),
		emissionAbsorbed : core => view?.emissionAbsorbed(core),
		paleSettled : amount => view?.paleSettled(amount),
		equipmentBroke : (core, equipment) => {
			view?.equipmentBroke(core)
			showNotice(`${core.definition.displayName}'s ${equipment.definition.displayName?.toLowerCase()} has worn out.`)
		},
		notification : (_kind, header, text) => showNotice(`${header}. ${text}`),
		storyAdvanced : (beat, firstTime) => {
			if (firstTime)
				logbook?.pageFound(beat)
			showEndingIfDue()
		},
		noteDiscovered : note => {
			logbook?.noteDiscovered(note)
			showNotice(`Added to the notebook: ${note.title}.`)
		},
	},
})

view = new ReactorView(document.querySelector(".pool-canvas") as HTMLCanvasElement, simulation)
panels = new Panels(document, simulation)
logbook = new Logbook(document, simulation)
logbook.onPagesCleared = showEndingIfDue
pendingNotices.splice(0).forEach(showNotice)

if (isNewGame)
	introCurtain.hidden = false
showEndingIfDue()

document.querySelector(".begin-shift")?.addEventListener("click", () => {
	introCurtain.hidden = true
	simulation.save(saveSlot)
})

document.querySelector(".seal-pool")?.addEventListener("click", () => {
	endingCurtain.hidden = true
	simulation.startNextShift()
})

document.querySelector(".start-over")?.addEventListener("click", () => {
	if (confirm("Start over? This wipes the pool, the logbook, and every shift you have worked.")) {
		simulation.reset()
		simulation.save(saveSlot)
		endingCurtain.hidden = true
		introCurtain.hidden = false
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

	// Nothing moves while the title card or the end-of-shift card is up.
	const paused = !introCurtain.hidden || !endingCurtain.hidden

	if (!paused) {
		if (elapsedMs > longestFrameMs) {
			simulation.bankTime((elapsedMs - longestFrameMs) / 1000)
			elapsedMs = longestFrameMs
		}

		simulation.advance(elapsedMs)
	}

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
