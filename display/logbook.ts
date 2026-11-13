// The logbook: pages found as the story advances, and the notebook of how things work.
// New pages are shown once as a card over the pool, then kept here.

import type { LogEntry, NoteDefinition, Simulation, StoryBeat } from "../sim/index.ts"

function paragraphs(text : string) : HTMLElement[] {
	return text.split("\n\n").map(block => {
		const paragraph = document.createElement("p")
		// Single line breaks inside a block are kept (the plant's records are set line by line).
		block.split("\n").forEach((line, lineIndex) => {
			if (lineIndex > 0)
				paragraph.append(document.createElement("br"))
			paragraph.append(line)
		})
		return paragraph
	})
}

function renderEntry(entry : LogEntry) : HTMLElement {
	const article = document.createElement("article")
	article.className = `logbook-entry ${entry.voice}`
	const title = document.createElement("h2")
	title.textContent = entry.title
	article.append(title, ...paragraphs(entry.body))
	return article
}

export class Logbook {
	private simulation : Simulation
	private readonly dialog : HTMLDialogElement
	private readonly pagesRoot : HTMLElement
	private readonly notesRoot : HTMLElement
	private readonly card : HTMLElement
	private readonly cardTitle : HTMLElement
	private readonly cardBody : HTMLElement
	private readonly openButton : HTMLElement
	private readonly waitingPages : StoryBeat[] = []
	private showingPage : StoryBeat | undefined

	/** Called when the last waiting page has been put away. */
	onPagesCleared : (() => void) | undefined

	constructor(page : ParentNode, simulation : Simulation) {
		this.simulation = simulation
		this.dialog = page.querySelector(".logbook") as HTMLDialogElement
		this.pagesRoot = page.querySelector(".logbook-pages") as HTMLElement
		this.notesRoot = page.querySelector(".logbook-notes") as HTMLElement
		this.card = page.querySelector(".page-card") as HTMLElement
		this.cardTitle = page.querySelector(".page-title") as HTMLElement
		this.cardBody = page.querySelector(".page-body") as HTMLElement
		this.openButton = page.querySelector(".open-logbook") as HTMLElement

		this.openButton.addEventListener("click", () => this.open())
		page.querySelector(".logbook-close")?.addEventListener("click", () => this.dialog.close())
		page.querySelector(".page-keep")?.addEventListener("click", () => this.keepPage())
		this.dialog.addEventListener("click", event => {
			// A click on the backdrop lands on the dialog element itself.
			if (event.target == this.dialog)
				this.dialog.close()
		})

		this.attach(simulation)
	}

	attach(simulation : Simulation) {
		this.simulation = simulation
		this.waitingPages.length = 0
		this.showingPage = undefined
		this.card.hidden = true
		this.refreshButton()
	}

	get hasWaitingPages() : boolean {
		return this.showingPage !== undefined || this.waitingPages.length > 0
	}

	/** A page was found for the first time: show it over the pool. */
	pageFound(beat : StoryBeat) {
		this.waitingPages.push(beat)
		if (!this.showingPage)
			this.showNextPage()
		this.refreshButton()
	}

	private showNextPage() {
		this.showingPage = this.waitingPages.shift()

		if (!this.showingPage) {
			this.card.hidden = true
			this.onPagesCleared?.()
			return
		}

		const entry = this.showingPage.entry
		this.card.className = `page-card ${entry.voice}`
		this.cardTitle.textContent = entry.title
		this.cardBody.replaceChildren(...paragraphs(entry.body))
		this.card.hidden = false
	}

	private keepPage() {
		this.showNextPage()
		this.refreshButton()
	}

	private refreshButton() {
		const pageCount = this.simulation.knownEntries.size
		this.openButton.hidden = pageCount == 0
		this.openButton.textContent = pageCount == 1 ? "Logbook, 1 page" : `Logbook, ${pageCount} pages`
	}

	noteDiscovered(_note : NoteDefinition) {
		this.refreshButton()
	}

	open() {
		const simulation = this.simulation
		const pages = simulation.content.story.filter(beat => simulation.knownEntries.has(beat.id))
		const notes = simulation.content.notes.filter(note => simulation.knownNotes.has(note.id))

		const pagesHeading = document.createElement("h2")
		pagesHeading.className = "logbook-section"
		pagesHeading.textContent = "Pages found"
		this.pagesRoot.replaceChildren(pagesHeading, ...pages.map(beat => renderEntry(beat.entry)))

		const notesHeading = document.createElement("h2")
		notesHeading.className = "logbook-section"
		notesHeading.textContent = "Notebook"
		this.notesRoot.replaceChildren(notesHeading, ...notes.map(note => {
			const item = document.createElement("article")
			item.className = "logbook-note"
			const title = document.createElement("h3")
			title.textContent = note.title
			const body = document.createElement("p")
			body.textContent = note.body
			item.append(title, body)
			return item
		}))

		this.dialog.showModal()
		this.pagesRoot.scrollTop = this.pagesRoot.scrollHeight
	}
}
