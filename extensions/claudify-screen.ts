import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	Key,
	matchesKey,
	Spacer,
	Text,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";

import { resolveMessageChromeSettings } from "./message-chrome.ts";
import { readSettings, writeSettingsKey, type SettingsFile } from "./settings.ts";

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

type MessageTextSettingsKey = "assistantPrefix" | "thinkingPrefix" | "hiddenThinkingLabel";

type EditableSettingsKey =
	| "toolBackground"
	| "readOutputMode"
	| "searchOutputMode"
	| "mcpOutputMode"
	| "bashOutputMode"
	| "previewLines"
	| "bashCollapsedLines"
	| "bashStackConsecutive"
	| "bashSemanticDisplay"
	| "readOnlyToolGrouping"
	| "readOnlyToolGroupLimit"
	| "expandedPreviewMaxLines"
	| "messageStyle"
	| "assistantPrefix"
	| "thinkingPrefix"
	| "messageSpacing"
	| "hiddenThinkingLabel";

interface SettingRowBase {
	readonly key: EditableSettingsKey;
	readonly label: string;
	readonly value: string | number | boolean;
}

interface EnumSettingRow extends SettingRowBase {
	readonly kind: "enum";
	readonly value: string;
	readonly values: readonly string[];
}

interface BooleanSettingRow extends SettingRowBase {
	readonly kind: "boolean";
	readonly value: boolean;
}

interface NumberSettingRow extends SettingRowBase {
	readonly kind: "number";
	readonly value: number;
	readonly min: number;
	readonly max?: number;
}

interface TextSettingRow extends SettingRowBase {
	readonly kind: "text";
	readonly key: MessageTextSettingsKey;
	readonly value: string;
}

type SettingRow = EnumSettingRow | BooleanSettingRow | NumberSettingRow | TextSettingRow;

type ClaudifyScreenState =
	| { readonly kind: "hub"; readonly selectedIndex: number }
	| {
		readonly kind: "section";
		readonly section: ClaudifySection;
		readonly hubSelectedIndex: number;
		readonly selectedIndex: number;
		readonly editing: boolean;
	};

type RenderRequester = Pick<TUI, "requestRender">;
type ScreenKeybindings = Pick<KeybindingsManager, "matches">;
type SettingChangeHandler = (key: EditableSettingsKey, value: unknown) => void;

interface EnumRowDefinition {
	readonly kind: "enum";
	readonly key: EditableSettingsKey;
	readonly label: string;
	readonly values: readonly string[];
	readonly defaultValue: string;
}

interface BooleanRowDefinition {
	readonly kind: "boolean";
	readonly key: EditableSettingsKey;
	readonly label: string;
	readonly defaultValue: boolean;
}

interface NumberRowDefinition {
	readonly kind: "number";
	readonly key: EditableSettingsKey;
	readonly label: string;
	readonly defaultValue: number;
	readonly min: number;
	readonly max?: number;
}

type ToolOutputRowDefinition = EnumRowDefinition | BooleanRowDefinition | NumberRowDefinition;

const TOOL_OUTPUT_ROWS: readonly ToolOutputRowDefinition[] = [
	{ kind: "enum", key: "toolBackground", label: "Tool background", values: ["default", "transparent", "outlines"], defaultValue: "transparent" },
	{ kind: "enum", key: "readOutputMode", label: "Read output", values: ["hidden", "summary", "preview"], defaultValue: "preview" },
	{ kind: "enum", key: "searchOutputMode", label: "Search output", values: ["hidden", "count", "preview"], defaultValue: "preview" },
	{ kind: "enum", key: "mcpOutputMode", label: "MCP output", values: ["hidden", "summary", "preview"], defaultValue: "preview" },
	{ kind: "enum", key: "bashOutputMode", label: "Bash output", values: ["opencode", "summary", "preview"], defaultValue: "opencode" },
	{ kind: "number", key: "previewLines", label: "Preview lines", defaultValue: 8, min: 1 },
	{ kind: "number", key: "bashCollapsedLines", label: "Collapsed Bash lines", defaultValue: 10, min: 0 },
	{ kind: "boolean", key: "bashStackConsecutive", label: "Stack consecutive Bash", defaultValue: true },
	{ kind: "boolean", key: "bashSemanticDisplay", label: "Semantic Bash display", defaultValue: true },
	{ kind: "boolean", key: "readOnlyToolGrouping", label: "Group read-only tools", defaultValue: true },
	{ kind: "number", key: "readOnlyToolGroupLimit", label: "Read-only group limit", defaultValue: 5, min: 1, max: 20 },
	{ kind: "number", key: "expandedPreviewMaxLines", label: "Expanded preview max lines", defaultValue: 4000, min: 1 },
];

class IndentedInput extends Input {
	override render(width: number): string[] {
		return super.render(Math.max(1, width - 3)).map((line) => `   ${line}`);
	}
}

function themedText(theme: Theme, color: "accent" | "dim" | "text", text: string): string {
	return theme.fg(color, text);
}

function effectiveEnumValue(settings: SettingsFile, definition: EnumRowDefinition): string {
	const value = settings[definition.key];
	return typeof value === "string" && definition.values.includes(value) ? value : definition.defaultValue;
}

function effectiveNumberValue(settings: SettingsFile, definition: NumberRowDefinition): number {
	const value = settings[definition.key];
	if (typeof value !== "number" || !Number.isFinite(value) || value < definition.min) return definition.defaultValue;
	return Math.min(definition.max ?? Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function toolOutputRows(settings: SettingsFile): SettingRow[] {
	return TOOL_OUTPUT_ROWS.map((definition): SettingRow => {
		if (definition.kind === "enum") {
			return { ...definition, value: effectiveEnumValue(settings, definition) };
		}
		if (definition.kind === "number") {
			return { ...definition, value: effectiveNumberValue(settings, definition) };
		}
		const value = settings[definition.key];
		return { ...definition, value: typeof value === "boolean" ? value : definition.defaultValue };
	});
}

function messageRows(settings: SettingsFile): SettingRow[] {
	const resolved = resolveMessageChromeSettings(settings);
	return [
		{ kind: "enum", key: "messageStyle", label: "Message style", value: resolved.messageStyle, values: ["classic", "claude"] },
		{ kind: "text", key: "assistantPrefix", label: "Assistant prefix", value: resolved.assistantPrefix },
		{ kind: "text", key: "thinkingPrefix", label: "Thinking prefix", value: resolved.thinkingPrefix },
		{ kind: "enum", key: "messageSpacing", label: "Message spacing", value: resolved.messageSpacing, values: ["compact", "comfortable"] },
		{ kind: "text", key: "hiddenThinkingLabel", label: "Hidden thinking label", value: resolved.hiddenThinkingLabel },
	];
}

function sectionRows(section: ClaudifySection): SettingRow[] {
	const settings = readSettings().values;
	if (section.id === "tool-output") return toolOutputRows(settings);
	if (section.id === "messages") return messageRows(settings);
	return [];
}

export class ClaudifyScreen extends Container implements Focusable {
	private readonly content = new Container();
	private readonly tui: RenderRequester;
	private readonly theme: Theme;
	private readonly keybindings: ScreenKeybindings;
	private readonly onClose: () => void;
	private readonly onSettingChange?: SettingChangeHandler;
	private state: ClaudifyScreenState = { kind: "hub", selectedIndex: 0 };
	private input: IndentedInput | null = null;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		if (this.input) this.input.focused = value;
	}

	constructor(
		tui: RenderRequester,
		theme: Theme,
		keybindings: ScreenKeybindings,
		onClose: () => void,
		onSettingChange?: SettingChangeHandler,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.onClose = onClose;
		this.onSettingChange = onSettingChange;
		this.addChild(this.content);
		this.renderState();
	}

	handleInput(data: string): void {
		if (this.state.kind === "section" && this.state.editing) {
			this.handleTextInput(data);
			return;
		}

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.handleEscape();
			return;
		}

		if (this.state.kind === "hub") {
			this.handleHubInput(data);
			return;
		}

		this.handleSectionInput(data);
	}

	private handleHubInput(data: string): void {
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
			this.state = {
				kind: "section",
				section,
				hubSelectedIndex: this.state.selectedIndex,
				selectedIndex: 0,
				editing: false,
			};
			this.renderState();
		}
	}

	private handleSectionInput(data: string): void {
		if (this.state.kind !== "section") return;
		const rows = sectionRows(this.state.section);
		if (rows.length === 0) return;

		if (this.keybindings.matches(data, "tui.select.up")) {
			this.updateSectionSelection(Math.max(0, this.state.selectedIndex - 1));
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.updateSectionSelection(Math.min(rows.length - 1, this.state.selectedIndex + 1));
			return;
		}

		const row = rows[this.state.selectedIndex];
		if (!row) return;
		const confirms = this.keybindings.matches(data, "tui.select.confirm") || matchesKey(data, Key.space);
		if (row.kind === "boolean" && confirms) {
			this.commitSetting(row.key, !row.value);
			return;
		}
		if (row.kind === "enum" && (confirms || this.isLeft(data) || this.isRight(data))) {
			const direction = this.isLeft(data) ? -1 : 1;
			const currentIndex = row.values.indexOf(row.value);
			const nextIndex = (currentIndex + direction + row.values.length) % row.values.length;
			this.commitSetting(row.key, row.values[nextIndex]);
			return;
		}
		if (row.kind === "number" && (this.isLeft(data) || this.isRight(data))) {
			const delta = this.isLeft(data) ? -1 : 1;
			const next = Math.max(row.min, Math.min(row.max ?? Number.MAX_SAFE_INTEGER, row.value + delta));
			if (next !== row.value) this.commitSetting(row.key, next);
			return;
		}
		if (row.kind === "text" && this.keybindings.matches(data, "tui.select.confirm")) {
			this.beginTextInput();
		}
	}

	private handleTextInput(data: string): void {
		if (this.state.kind !== "section" || !this.state.editing || !this.input) return;
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.finishTextInput();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.submitTextInput(this.input.getValue());
			return;
		}
		this.input.handleInput(data);
		this.tui.requestRender();
	}

	private isLeft(data: string): boolean {
		return this.keybindings.matches(data, "tui.editor.cursorLeft") || matchesKey(data, Key.left);
	}

	private isRight(data: string): boolean {
		return this.keybindings.matches(data, "tui.editor.cursorRight") || matchesKey(data, Key.right);
	}

	private handleEscape(): void {
		if (this.state.kind === "hub") {
			this.onClose();
			return;
		}
		this.state = { kind: "hub", selectedIndex: this.state.hubSelectedIndex };
		this.renderState();
	}

	private updateHubSelection(selectedIndex: number): void {
		if (this.state.kind !== "hub" || selectedIndex === this.state.selectedIndex) return;
		this.state = { kind: "hub", selectedIndex };
		this.renderState();
	}

	private updateSectionSelection(selectedIndex: number): void {
		if (this.state.kind !== "section" || selectedIndex === this.state.selectedIndex) return;
		this.state = { ...this.state, selectedIndex };
		this.renderState();
	}

	private commitSetting(key: EditableSettingsKey, value: unknown): void {
		writeSettingsKey(key, value);
		this.onSettingChange?.(key, value);
		this.renderState();
	}

	private beginTextInput(): void {
		if (this.state.kind !== "section") return;
		this.state = { ...this.state, editing: true };
		this.renderState();
		this.input?.setValue("");
		this.tui.requestRender();
	}

	private submitTextInput(rawValue: string): void {
		if (this.state.kind !== "section") return;
		const row = sectionRows(this.state.section)[this.state.selectedIndex];
		if (!row || row.kind !== "text") return;
		// An empty/whitespace-only submit cancels rather than resetting to the
		// built-in default: opening a text row (Enter) then a reflexive second
		// Enter must not silently wipe the user's customized prefix/label.
		if (rawValue.trim().length === 0) {
			this.finishTextInput();
			return;
		}
		const settings = readSettings().values;
		const resolved = resolveMessageChromeSettings({ ...settings, [row.key]: rawValue });
		this.finishTextInput(false);
		this.commitSetting(row.key, resolved[row.key]);
	}

	private finishTextInput(render = true): void {
		if (this.state.kind !== "section") return;
		this.state = { ...this.state, editing: false };
		this.input = null;
		if (render) this.renderState();
	}

	private renderState(): void {
		this.content.clear();
		this.input = null;
		if (this.state.kind === "hub") {
			this.renderHub(this.state.selectedIndex);
		} else {
			this.renderSection(this.state);
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

	private renderSection(state: Extract<ClaudifyScreenState, { kind: "section" }>): void {
		const { section } = state;
		this.content.addChild(new Text(themedText(this.theme, "accent", this.theme.bold(section.label)), 3, 0));
		this.content.addChild(new Spacer(1));
		const rows = sectionRows(section);
		if (rows.length === 0) {
			this.content.addChild(new Text(themedText(this.theme, "dim", section.placeholder), 3, 0));
			this.content.addChild(new Spacer(1));
			this.content.addChild(new Text(themedText(this.theme, "dim", "Esc to go back"), 3, 0));
			return;
		}

		const labelWidth = Math.max(...rows.map((row) => row.label.length)) + 4;
		for (const [index, row] of rows.entries()) {
			const selected = index === state.selectedIndex;
			const marker = selected ? themedText(this.theme, "accent", "❯") : " ";
			const label = themedText(this.theme, "text", row.label.padEnd(labelWidth));
			const value = themedText(this.theme, "text", String(row.value));
			this.content.addChild(new Text(`${marker} ${label}${value}`, 3, 0));
		}

		if (state.editing) {
			const row = rows[state.selectedIndex];
			this.content.addChild(new Spacer(1));
			this.content.addChild(new Text(themedText(this.theme, "dim", `New value for ${row?.label ?? "setting"}`), 3, 0));
			this.input = new IndentedInput();
			this.input.focused = this.focused;
			this.content.addChild(this.input);
		}

		this.content.addChild(new Spacer(1));
		this.content.addChild(new Text(themedText(this.theme, "dim", this.sectionFooter(rows[state.selectedIndex], state.editing)), 3, 0));
	}

	private sectionFooter(row: SettingRow | undefined, editing: boolean): string {
		if (editing) return "Type a value · Enter to save · Esc to cancel";
		if (row?.kind === "number") return "↑/↓ to move · ←/→ to change · Esc to back";
		if (row?.kind === "text") return "↑/↓ to move · Enter to edit · Esc to back";
		return "↑/↓ to move · Enter/Space to change · Esc to back";
	}
}
