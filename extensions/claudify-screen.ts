import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, type TUI } from "@earendil-works/pi-tui";

export interface ClaudifySection {
	readonly id: "theme" | "diffs" | "spinner" | "messages" | "tool-output";
	readonly label: "Theme" | "Diffs" | "Spinner" | "Messages" | "Tool output";
	readonly placeholder: string;
}

export const CLAUDIFY_SECTIONS: readonly ClaudifySection[] = [
	{ id: "theme", label: "Theme", placeholder: "Theme settings — coming soon" },
	{ id: "diffs", label: "Diffs", placeholder: "Diff settings — coming soon" },
	{ id: "spinner", label: "Spinner", placeholder: "Spinner settings — coming soon" },
	{ id: "messages", label: "Messages", placeholder: "Message settings — coming soon" },
	{ id: "tool-output", label: "Tool output", placeholder: "Tool output settings — coming soon" },
];

type ClaudifyScreenState =
	| { readonly kind: "hub"; readonly selectedIndex: number }
	| { readonly kind: "section"; readonly section: ClaudifySection; readonly selectedIndex: number };

type RenderRequester = Pick<TUI, "requestRender">;
type ScreenKeybindings = Pick<KeybindingsManager, "matches">;

// `accent | dim | text` are required core theme colors present in every loaded
// theme, so `fg` does not throw here in normal operation. If a theme is missing
// a core color the throw is surfaced cleanly by the command runner as a visible
// extension error — preferable to silently rendering the wrong color. (A bare
// catch also could not deliver theme-robustness anyway: the sibling
// `theme.bold(...)` call in renderSection is likewise unguarded.)
function themedText(theme: Theme, color: "accent" | "dim" | "text", text: string): string {
	return theme.fg(color, text);
}

export class ClaudifyScreen extends Container {
	private readonly content = new Container();
	private readonly tui: RenderRequester;
	private readonly theme: Theme;
	private readonly keybindings: ScreenKeybindings;
	private readonly onClose: () => void;
	private state: ClaudifyScreenState = { kind: "hub", selectedIndex: 0 };

	constructor(tui: RenderRequester, theme: Theme, keybindings: ScreenKeybindings, onClose: () => void) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.onClose = onClose;
		this.addChild(this.content);
		this.renderState();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.handleEscape();
			return;
		}

		if (this.state.kind !== "hub") return;

		if (this.keybindings.matches(data, "tui.select.up")) {
			this.updateHubSelection(Math.max(0, this.state.selectedIndex - 1));
			return;
		}

		if (this.keybindings.matches(data, "tui.select.down")) {
			this.updateHubSelection(Math.min(CLAUDIFY_SECTIONS.length - 1, this.state.selectedIndex + 1));
			return;
		}

		if (this.keybindings.matches(data, "tui.select.confirm")) {
			const section = CLAUDIFY_SECTIONS[this.state.selectedIndex];
			if (!section) return;
			this.state = { kind: "section", section, selectedIndex: this.state.selectedIndex };
			this.renderState();
		}
	}

	private handleEscape(): void {
		if (this.state.kind === "hub") {
			this.onClose();
			return;
		}

		this.state = { kind: "hub", selectedIndex: this.state.selectedIndex };
		this.renderState();
	}

	private updateHubSelection(selectedIndex: number): void {
		if (this.state.kind !== "hub" || selectedIndex === this.state.selectedIndex) return;
		this.state = { kind: "hub", selectedIndex };
		this.renderState();
	}

	private renderState(): void {
		this.content.clear();
		if (this.state.kind === "hub") {
			this.renderHub(this.state.selectedIndex);
		} else {
			this.renderSection(this.state.section);
		}
		this.tui.requestRender();
	}

	private renderHub(selectedIndex: number): void {
		for (const [index, section] of CLAUDIFY_SECTIONS.entries()) {
			const selected = index === selectedIndex;
			const marker = selected ? themedText(this.theme, "accent", "❯") : " ";
			const label = themedText(this.theme, "text", section.label);
			this.content.addChild(new Text(`${marker} ${label}`, 3, 0));
		}
		this.content.addChild(new Spacer(1));
		this.content.addChild(new Text(themedText(this.theme, "dim", "↑/↓ to move · Enter to open · Esc to close"), 3, 0));
	}

	private renderSection(section: ClaudifySection): void {
		this.content.addChild(new Text(themedText(this.theme, "accent", this.theme.bold(section.label)), 3, 0));
		this.content.addChild(new Spacer(1));
		this.content.addChild(new Text(themedText(this.theme, "dim", section.placeholder), 3, 0));
		this.content.addChild(new Spacer(1));
		this.content.addChild(new Text(themedText(this.theme, "dim", "Esc to go back"), 3, 0));
	}
}
