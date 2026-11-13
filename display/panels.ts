// The control panels either side of the pool: one strip per core, and the station.
// Built once per world, then refreshed a few times a second by writing only what changed.

import type { Core, GameAction, SimObject, Simulation } from "../sim/index.ts"
import { formatDuration, formatEnergy, formatNumber, formatValue } from "./format.ts"

function createElement<TagName extends keyof HTMLElementTagNameMap>(tagName : TagName, className? : string, text? : string) : HTMLElementTagNameMap[TagName] {
	const created = document.createElement(tagName)
	if (className)
		created.className = className
	if (text !== undefined)
		created.textContent = text
	return created
}

function setText(target : HTMLElement, text : string) {
	if (target.textContent !== text)
		target.textContent = text
}

function setHidden(target : HTMLElement, hidden : boolean) {
	if (target.hidden !== hidden)
		target.hidden = hidden
}

function formatMass(mass : number) : string {
	return formatNumber(mass, mass < 100 ? 1 : 0)
}

/** "12.0 J", "400 Pale", or "20.0 MJ and 1.20 k Pale". */
function priceOf(action : GameAction) : string {
	const parts = Object.entries(action.calculatedCost).map(([resourceName, amount]) =>
		resourceName == "energy" ? formatEnergy(amount) : `${formatNumber(amount, 0)} ${action.simulation.object(resourceName).definition.displayName}`)
	return parts.join(" and ")
}

/** Something on screen that refreshes itself from the simulation. */
type Refresher = () => void

export class Panels {
	private simulation : Simulation
	private refreshers : Refresher[] = []

	private readonly room : HTMLElement
	private readonly coresRoot : HTMLElement
	private readonly worksRoot : HTMLElement
	private readonly energyValue : HTMLElement
	private readonly energyUnit : HTMLElement
	private readonly energyRate : HTMLElement
	private readonly paleLine : HTMLElement
	private readonly bankLine : HTMLElement

	constructor(page : ParentNode, simulation : Simulation) {
		this.simulation = simulation
		this.room = page.querySelector(".control-room") as HTMLElement
		this.coresRoot = page.querySelector(".cores-panel") as HTMLElement
		this.worksRoot = page.querySelector(".works-panel") as HTMLElement
		this.energyValue = page.querySelector(".readout-energy-value") as HTMLElement
		this.energyUnit = page.querySelector(".readout-energy-unit") as HTMLElement
		this.energyRate = page.querySelector(".readout-rate") as HTMLElement
		this.paleLine = page.querySelector(".readout-pale") as HTMLElement
		this.bankLine = page.querySelector(".readout-bank") as HTMLElement

		this.rebuild(simulation)
	}

	rebuild(simulation : Simulation) {
		this.simulation = simulation
		this.refreshers = []

		this.coresRoot.replaceChildren(createElement("h1", "panel-title", "Cores"), ...simulation.cores.map(core => this.buildCoreStrip(core)))
		this.worksRoot.replaceChildren(
			this.buildObjective(),
			this.buildSection("Station", "repair"),
			this.buildFigures(),
			this.buildSection("Workshop", "upgrade"),
			this.buildSection("Centre well", "refinement"),
		)

		this.update()
	}

	update() {
		const simulation = this.simulation
		const energy = simulation.engine.energy
		const energyText = formatEnergy(energy.value)
		const unitStart = energyText.lastIndexOf(" ")

		this.room.classList.toggle("unlit", !simulation.has("lightsRepair"))

		setText(this.energyValue, energyText.slice(0, unitStart))
		setText(this.energyUnit, energyText.slice(unitStart + 1))
		setHidden(this.energyRate, !simulation.has("instrumentsRepair"))
		setText(this.energyRate, `${formatEnergy(Math.max(0, energy.changeSpeed) / simulation.speed)} a second`)

		const pale = simulation.engine.pale
		setHidden(this.paleLine, !pale.seen)
		if (pale.seen)
			setText(this.paleLine, `${formatNumber(pale.value, pale.value < 100 ? 1 : 0)} Pale at ${Math.round(simulation.engine.accord.value * 100)}% accord`)

		const bankedSeconds = simulation.engine.timeBank.value
		setHidden(this.bankLine, bankedSeconds <= 0)
		if (bankedSeconds > 0)
			setText(this.bankLine, `Double speed for ${formatDuration(bankedSeconds)}`)

		for (const refresh of this.refreshers)
			refresh()
	}

	// --- cores ---

	private buildCoreStrip(core : Core) : HTMLElement {
		const simulation = this.simulation
		const tuning = simulation.tuning
		const strip = createElement("article", "core-strip")
		strip.style.setProperty("--core-color", core.color)

		const heading = createElement("header", "core-heading")
		const name = createElement("h2", "core-name", core.definition.displayName)
		const mass = createElement("span", "core-mass")
		heading.append(createElement("span", "core-dot"), name, mass)

		const status = createElement("p", "core-status")
		const flight = createElement("p", "core-status")

		const railLabel = createElement("label", "dial")
		const railCaption = createElement("span", "dial-caption", "Distance from centre")
		const railValue = createElement("output", "dial-value")
		const railInput = createElement("input")
		railInput.type = "range"
		railInput.min = String(tuning.railMin)
		railInput.max = String(tuning.railMax)
		railInput.step = "0.5"
		railInput.addEventListener("input", () => core.setRailTarget(Number(railInput.value)))
		railLabel.append(railCaption, railValue, railInput)

		const fireButton = createElement("button", "action quiet", `Fire a particle into ${core.definition.displayName}`)
		fireButton.type = "button"
		fireButton.addEventListener("click", () => core.fire())
		const fireNote = createElement("p", "action-note", `Knocks a particle out towards ${core.next.definition.displayName}.`)

		strip.append(heading, status, flight, railLabel, fireButton, fireNote,
			this.buildEquipmentRow(core, core.own.source),
			this.buildEquipmentRow(core, core.own.reflector),
			this.buildEquipmentRow(core, core.own.poison),
			this.buildEquipmentRow(core, core.own.rods))

		this.refreshers.push(() => {
			const instruments = simulation.has("instrumentsRepair")
			setText(mass, formatMass(core.value))
			setHidden(status, !instruments)
			setHidden(flight, !instruments)
			setText(status, `Emits ${formatNumber(core.own.emissionRate.value, 2)} times a second`)
			setText(flight, core.inFlight > 0 ? `${formatMass(core.inFlight)} of its mass is in flight` : "All of its mass is at rest")
			setHidden(railLabel, !simulation.has("railRepair"))
			setText(railValue, core.railPosition == core.railTarget ? core.railPosition.toFixed(1) : `${core.railPosition.toFixed(1)} → ${core.railTarget.toFixed(1)}`)
			if (document.activeElement != railInput && railInput.value != String(core.railTarget))
				railInput.value = String(core.railTarget)
			fireButton.disabled = core.value < simulation.engine.injectionMass.value
		})

		return strip
	}

	private buildEquipmentRow(core : Core, equipment : GameAction) : HTMLElement {
		const own = core.own
		const row = createElement("div", "equipment")
		const title = createElement("div", "equipment-title")
		const name = createElement("strong", undefined, equipment.definition.displayName)
		const state = createElement("span", "equipment-state")
		title.append(name, state)

		const description = createElement("p", "equipment-description", equipment.definition.description)
		const button = createElement("button", "action")
		button.type = "button"
		button.addEventListener("click", () => equipment.buy())

		row.append(title, description, button)

		let extraRefresh : Refresher = () => {}

		if (equipment == own.reflector) {
			const meter = createElement("div", "wear")
			const meterFill = createElement("div", "wear-fill")
			meter.append(meterFill)
			row.append(meter)
			extraRefresh = () => {
				const installed = equipment.value > 0
				const lifeFraction = own.reflectorLife.value / this.simulation.tuning.reflectorLife
				setHidden(meter, !installed)
				meterFill.style.width = `${Math.round(lifeFraction * 100)}%`
				setText(state, installed ? `${Math.round(lifeFraction * 100)}% left` : "")
			}
		} else if (equipment == own.rods) {
			const rodLabel = createElement("label", "dial")
			const rodCaption = createElement("span", "dial-caption", "How far in")
			const rodValue = createElement("output", "dial-value")
			const rodInput = createElement("input")
			rodInput.type = "range"
			rodInput.min = "0"
			rodInput.max = "100"
			rodInput.step = "1"
			rodInput.addEventListener("input", () => core.setRodInsertion(Number(rodInput.value) / 100))
			rodLabel.append(rodCaption, rodValue, rodInput)
			row.append(rodLabel)
			extraRefresh = () => {
				const installed = equipment.value > 0
				const percent = Math.round(own.rodInsertion.value * 100)
				setHidden(rodLabel, !installed)
				setText(rodValue, `${percent}%`)
				setText(state, installed ? "Fitted" : "")
				if (document.activeElement != rodInput && rodInput.value != String(percent))
					rodInput.value = String(percent)
			}
		} else if (equipment == own.poison) {
			extraRefresh = () => {
				const chargesLeft = own.poisonCharges.value
				setText(state, chargesLeft > 0 ? `${chargesLeft} emissions left` : "")
			}
		} else {
			extraRefresh = () => setText(state, equipment.value > 0 ? "Fitted" : "")
		}

		const verb = equipment == own.poison ? "Dose" : "Fit"

		this.refreshers.push(() => {
			setHidden(row, !equipment.seen)
			if (!equipment.seen)
				return

			setHidden(button, equipment.bought)
			setText(button, `${verb} for ${priceOf(equipment)}`)
			button.disabled = !equipment.canAfford
			extraRefresh()
		})

		return row
	}

	// --- station ---

	private buildObjective() : HTMLElement {
		const block = createElement("div", "objective")
		const caption = createElement("span", "objective-caption", "Next")
		const text = createElement("p", "objective-text")
		block.append(caption, text)

		this.refreshers.push(() => {
			const beat = this.simulation.currentBeat
			setText(text, beat ? beat.objective : "Seal the pool.")
		})

		return block
	}

	private buildFigures() : HTMLElement {
		const list = createElement("dl", "figures")
		const shown : Array<{ stat : SimObject, term : HTMLElement, figure : HTMLElement }> = []

		for (const statName of ["totalMass", "emissionMass", "yield", "particleSpeed", "accord", "energyBonus"]) {
			const stat = this.simulation.object(statName)
			const term = createElement("dt", undefined, stat.definition.displayName)
			const figure = createElement("dd")
			list.append(term, figure)
			shown.push({ stat, term, figure })
		}

		this.refreshers.push(() => {
			setHidden(list, !this.simulation.has("instrumentsRepair"))
			for (const { stat, term, figure } of shown) {
				setHidden(term, !stat.seen && stat.definition.seen !== true && !["emissionMass", "yield", "particleSpeed"].includes(stat.name))
				setHidden(figure, term.hidden === true)
				setText(figure, formatValue(stat.value, stat.definition.format))
			}
		})

		return list
	}

	/** A titled group of things to buy. Hidden until one of them is visible; finished ones collapse to a line. */
	private buildSection(title : string, kind : "repair" | "upgrade" | "refinement") : HTMLElement {
		const actions = [...this.simulation.data.values()].filter((object) : object is GameAction => object.kind == kind)
		const section = createElement("section", "works-section")
		const done = createElement("p", "works-done")
		section.append(createElement("h1", "panel-title", title), ...actions.map(action => this.buildAction(action, kind)), done)

		this.refreshers.push(() => {
			setHidden(section, !actions.some(action => action.seen))
			const finished = actions.filter(action => action.bought)
			setHidden(done, finished.length == 0)
			if (finished.length)
				setText(done, kind == "repair"
					? `Working: ${finished.map(action => action.definition.displayName?.toLowerCase()).join(", ")}.`
					: `Complete: ${finished.map(action => action.definition.displayName?.toLowerCase()).join(", ")}.`)
		})

		return section
	}

	private buildAction(action : GameAction, kind : "repair" | "upgrade" | "refinement") : HTMLElement {
		const card = createElement("article", "upgrade")
		const heading = createElement("header", "upgrade-heading")
		const level = createElement("span", "upgrade-level")
		heading.append(createElement("h2", "upgrade-name", action.definition.displayName), level)

		const needs = createElement("ul", "needs")
		const button = createElement("button", "action")
		button.type = "button"
		button.addEventListener("click", () => action.buy())

		card.append(heading, createElement("p", "upgrade-description", action.definition.description), needs, button)

		const verb = kind == "repair" ? "Restore" : "Build"
		let needsBuiltForLevel = -1
		let needItems : Array<{ item : HTMLElement, needed : SimObject, amount : number }> = []

		this.refreshers.push(() => {
			// Finished items leave the list; the section's summary line names them.
			setHidden(card, !action.seen || action.bought)
			if (card.hidden)
				return

			if (needsBuiltForLevel != action.value) {
				needsBuiltForLevel = action.value
				needItems = Object.entries(action.calculatedRequirements).map(([neededName, amount]) => {
					const needed = this.simulation.object(neededName)
					const item = createElement("li", undefined, `${needed.definition.displayName} at ${formatMass(amount)}`)
					return { item, needed, amount }
				})
				needs.replaceChildren(...needItems.map(need => need.item))
				setHidden(needs, needItems.length == 0)
			}

			for (const need of needItems)
				need.item.classList.toggle("unmet", need.needed.value < need.amount)

			setText(level, kind == "repair" ? "" : `Level ${action.value}`)
			setText(button, `${verb} for ${priceOf(action)}`)
			button.disabled = !action.canAfford
		})

		return card
	}
}
