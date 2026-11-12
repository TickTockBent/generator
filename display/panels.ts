// The control panels either side of the pool: one strip per core, and the upgrades.
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

function priceOf(action : GameAction) : string {
	return formatEnergy(action.calculatedCost.energy ?? 0)
}

/** Something on screen that refreshes itself from the simulation. */
type Refresher = () => void

export class Panels {
	private simulation : Simulation
	private refreshers : Refresher[] = []

	private readonly coresRoot : HTMLElement
	private readonly worksRoot : HTMLElement
	private readonly energyValue : HTMLElement
	private readonly energyUnit : HTMLElement
	private readonly energyRate : HTMLElement
	private readonly bankLine : HTMLElement

	constructor(page : ParentNode, simulation : Simulation) {
		this.simulation = simulation
		this.coresRoot = page.querySelector(".cores-panel") as HTMLElement
		this.worksRoot = page.querySelector(".works-panel") as HTMLElement
		this.energyValue = page.querySelector(".readout-energy-value") as HTMLElement
		this.energyUnit = page.querySelector(".readout-energy-unit") as HTMLElement
		this.energyRate = page.querySelector(".readout-rate") as HTMLElement
		this.bankLine = page.querySelector(".readout-bank") as HTMLElement

		this.rebuild(simulation)
	}

	rebuild(simulation : Simulation) {
		this.simulation = simulation
		this.refreshers = []

		this.coresRoot.replaceChildren(createElement("h1", "panel-title", "Cores"), ...simulation.cores.map(core => this.buildCoreStrip(core)))
		this.worksRoot.replaceChildren(createElement("h1", "panel-title", "Upgrades"), this.buildFigures(), ...this.buildUpgrades())

		this.update()
	}

	update() {
		const simulation = this.simulation
		const energy = simulation.engine.energy
		const energyText = formatEnergy(energy.value)
		const unitStart = energyText.lastIndexOf(" ")

		setText(this.energyValue, energyText.slice(0, unitStart))
		setText(this.energyUnit, energyText.slice(unitStart + 1))
		setText(this.energyRate, `${formatEnergy(Math.max(0, energy.changeSpeed) / simulation.speed)} a second`)

		const bankedSeconds = simulation.engine.timeBank.value
		setHidden(this.bankLine, bankedSeconds <= 0)
		if (bankedSeconds > 0)
			setText(this.bankLine, `Running at double speed for ${formatDuration(bankedSeconds)}`)

		for (const refresh of this.refreshers)
			refresh()
	}

	// --- cores ---

	private buildCoreStrip(core : Core) : HTMLElement {
		const tuning = this.simulation.tuning
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

		const fireButton = createElement("button", "action quiet", "Fire a particle")
		fireButton.type = "button"
		fireButton.addEventListener("click", () => core.fire())

		strip.append(heading, status, flight, railLabel, fireButton,
			this.buildEquipmentRow(core, core.own.source),
			this.buildEquipmentRow(core, core.own.reflector),
			this.buildEquipmentRow(core, core.own.poison),
			this.buildEquipmentRow(core, core.own.rods))

		this.refreshers.push(() => {
			setText(mass, formatNumber(core.value, core.value < 100 ? 1 : 0))
			setText(status, `Emits ${formatNumber(core.own.emissionRate.value, 2)} times a second`)
			setText(flight, core.inFlight > 0 ? `${formatNumber(core.inFlight, core.inFlight < 100 ? 1 : 0)} of its mass is in flight` : "All of its mass is at rest")
			setText(railValue, core.railPosition == core.railTarget ? core.railPosition.toFixed(1) : `${core.railPosition.toFixed(1)} → ${core.railTarget.toFixed(1)}`)
			if (document.activeElement != railInput && railInput.value != String(core.railTarget))
				railInput.value = String(core.railTarget)
			fireButton.disabled = core.value < this.simulation.engine.emissionMass.value
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
				setText(state, installed ? "Installed" : "")
				if (document.activeElement != rodInput && rodInput.value != String(percent))
					rodInput.value = String(percent)
			}
		} else if (equipment == own.poison) {
			extraRefresh = () => {
				const chargesLeft = own.poisonCharges.value
				setText(state, chargesLeft > 0 ? `${chargesLeft} emissions left` : "")
			}
		} else {
			extraRefresh = () => setText(state, equipment.value > 0 ? "Installed" : "")
		}

		const verb = equipment == own.poison ? "Dose" : "Install"

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

	// --- upgrades ---

	private buildFigures() : HTMLElement {
		const list = createElement("dl", "figures")

		for (const statName of ["totalMass", "emissionMass", "yield", "particleSpeed"]) {
			const stat = this.simulation.object(statName)
			const term = createElement("dt", undefined, stat.definition.displayName)
			const figure = createElement("dd")
			list.append(term, figure)
			this.refreshers.push(() => setText(figure, formatValue(stat.value, stat.definition.format)))
		}

		return list
	}

	private buildUpgrades() : HTMLElement[] {
		const upgrades = [...this.simulation.data.values()].filter((object) : object is GameAction => object.kind == "upgrade")
		const empty = createElement("p", "panel-empty", "Nothing to buy yet. Make some energy: tap a core to fire it, or drag the cores closer together so they set each other off.")

		this.refreshers.push(() => setHidden(empty, upgrades.some(upgrade => upgrade.seen)))

		return [empty, ...upgrades.map(upgrade => this.buildUpgrade(upgrade))]
	}

	private buildUpgrade(upgrade : GameAction) : HTMLElement {
		const card = createElement("article", "upgrade")
		const heading = createElement("header", "upgrade-heading")
		const level = createElement("span", "upgrade-level")
		heading.append(createElement("h2", "upgrade-name", upgrade.definition.displayName), level)

		const needs = createElement("ul", "needs")
		const button = createElement("button", "action")
		button.type = "button"
		button.addEventListener("click", () => upgrade.buy())

		card.append(heading, createElement("p", "upgrade-description", upgrade.definition.description), needs, button)

		let needsBuiltForLevel = -1
		let needItems : Array<{ item : HTMLElement, needed : SimObject, amount : number }> = []

		this.refreshers.push(() => {
			setHidden(card, !upgrade.seen)
			if (!upgrade.seen)
				return

			if (needsBuiltForLevel != upgrade.value) {
				needsBuiltForLevel = upgrade.value
				needItems = Object.entries(upgrade.calculatedRequirements).map(([neededName, amount]) => {
					const needed = this.simulation.object(neededName)
					const item = createElement("li", undefined, `${needed.definition.displayName} at ${formatNumber(amount, amount < 100 ? 1 : 0)}`)
					return { item, needed, amount }
				})
				needs.replaceChildren(...needItems.map(need => need.item))
				setHidden(needs, needItems.length == 0 || upgrade.bought)
			}

			for (const need of needItems)
				need.item.classList.toggle("unmet", need.needed.value < need.amount)

			setText(level, upgrade.bought ? `Level ${upgrade.value}, complete` : `Level ${upgrade.value}`)
			setHidden(button, upgrade.bought)
			setText(button, `Buy for ${priceOf(upgrade)}`)
			button.disabled = !upgrade.canAfford
		})

		return card
	}
}
