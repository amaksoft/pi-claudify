import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

export const FULLSCREEN_WIDGET_KEY = "claudify-fullscreen-tui";
export const ALT_SCREEN_ENTER = "\x1b[?1049h\x1b[2J\x1b[H";
export const ALT_SCREEN_LEAVE = "\x1b[?1049l";
export const NORMAL_SCREEN_CLEAR = "\x1b[2J\x1b[H";
const MOUSE_REPORTING_ENABLE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
const MOUSE_REPORTING_DISABLE = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

let markerSequence = 0;

interface FullscreenTui extends TUI {
	render(width: number): string[];
}

export interface FullscreenController {
	readonly marker: string;
	readonly active: boolean;
	enable(): void;
	scrollPage(direction: "up" | "down"): boolean;
	scrollWheel(direction: "up" | "down"): void;
	followBottom(): void;
	disable(options?: { clearNormalBufferAfterRender?: boolean }): void;
}

function isFullWidthBlank(line: string, width: number): boolean {
	return width > 0 && line === " ".repeat(width);
}

function removeIdleStatusBefore(lines: string[], beforeIndex: number, width: number): boolean {
	if (
		beforeIndex < 3
		|| lines[beforeIndex - 1] !== ""
		|| !isFullWidthBlank(lines[beforeIndex - 2] ?? "", width)
		|| !isFullWidthBlank(lines[beforeIndex - 3] ?? "", width)
	) return false;
	lines.splice(beforeIndex - 3, 2);
	return true;
}

export function stripMountedIdleStatus(lines: string[], width: number): string[] {
	for (let index = 3; index <= lines.length; index += 1) {
		const next = [...lines];
		if (removeIdleStatusBefore(next, index, width)) return next;
	}
	return lines;
}

const SCROLL_BOTTOM_HINT = process.platform === "darwin"
	? "Jump to bottom: fn+↓ to scroll"
	: "Jump to bottom: Page Down to scroll";
const ANSI_DIM = "\x1b[2m";
const ANSI_DIM_OFF = "\x1b[22m";

interface FullscreenLayout {
	lines: string[];
	maxScrollOffset: number;
	scrollOffset: number;
	transcriptRows: number;
	viewportRows: number;
}

/**
 * Replace the marker above Pi's editor with a bounded transcript viewport.
 * Pi's two full-width IdleStatus rows are removed only when their exact
 * grammar appears immediately before the widget's own empty spacer.
 */
function layoutFullscreenLines(
	lines: string[],
	marker: string,
	rows: number,
	width: number,
	scrollOffset = 0,
): FullscreenLayout | undefined {
	let markerIndex = lines.findIndex((line) => line.includes(marker));
	if (markerIndex === -1) return undefined;

	const next = [...lines];
	if (removeIdleStatusBefore(next, markerIndex, width)) markerIndex -= 2;

	const transcript = next.slice(0, markerIndex);
	const chrome = next.slice(markerIndex + 1);
	const terminalRows = Number.isFinite(rows) ? Math.max(0, Math.trunc(rows)) : 0;
	const viewportRows = Math.max(0, terminalRows - chrome.length);
	const maxScrollOffset = Math.max(0, transcript.length - viewportRows);
	const boundedScrollOffset = Math.min(maxScrollOffset, Math.max(0, Math.trunc(scrollOffset)));
	const end = transcript.length - boundedScrollOffset;
	const start = Math.max(0, end - viewportRows);
	const visibleTranscript = transcript.slice(start, end);
	if (boundedScrollOffset > 0 && visibleTranscript.length > 0) {
		const hintWidth = visibleWidth(SCROLL_BOTTOM_HINT);
		if (width > hintWidth + 1) {
			const lastIndex = visibleTranscript.length - 1;
			const content = truncateToWidth(visibleTranscript[lastIndex] ?? "", width - hintWidth - 1, "");
			const gap = " ".repeat(Math.max(1, width - visibleWidth(content) - hintWidth));
			visibleTranscript[lastIndex] = `${content}${gap}${ANSI_DIM}${SCROLL_BOTTOM_HINT}${ANSI_DIM_OFF}`;
		}
	}
	const fill = Math.max(0, viewportRows - visibleTranscript.length);

	return {
		lines: [...visibleTranscript, ...Array<string>(fill).fill(""), ...chrome],
		maxScrollOffset,
		scrollOffset: boundedScrollOffset,
		transcriptRows: transcript.length,
		viewportRows,
	};
}

export function fillFullscreenLines(
	lines: string[],
	marker: string,
	rows: number,
	width: number,
	scrollOffset = 0,
): string[] {
	return layoutFullscreenLines(lines, marker, rows, width, scrollOffset)?.lines ?? lines;
}

export function createFullscreenMarker(marker: string): Component {
	return {
		render: () => [marker],
		invalidate: () => {},
	};
}

function hasFullscreenCapabilities(tui: TUI): tui is FullscreenTui {
	return typeof tui.render === "function"
		&& typeof tui.requestRender === "function"
		&& typeof tui.getClearOnShrink === "function"
		&& typeof tui.setClearOnShrink === "function"
		&& typeof tui.terminal?.write === "function"
		&& typeof tui.terminal?.rows === "number";
}

export function createFullscreenController(tui: TUI, marker: string): FullscreenController | undefined {
	if (!hasFullscreenCapabilities(tui)) return undefined;

	const originalRender = tui.render;
	const previousClearOnShrink = tui.getClearOnShrink();
	let enabled = false;
	let cleanupIdleStatus = false;
	let enteredAlternateScreen = false;
	let mouseReportingEnabled = false;
	let scrollOffset = 0;
	let maxScrollOffset = 0;
	let viewportRows = 0;
	let previousTranscriptRows: number | undefined;

	const wrappedRender = function (this: FullscreenTui, width: number): string[] {
		const lines = originalRender.call(this, width);
		if (enabled) {
			let layout = layoutFullscreenLines(lines, marker, this.terminal.rows, width, scrollOffset);
			if (!layout) {
				maxScrollOffset = 0;
				previousTranscriptRows = undefined;
				return lines;
			}
			if (scrollOffset > 0 && previousTranscriptRows !== undefined && layout.transcriptRows > previousTranscriptRows) {
				scrollOffset += layout.transcriptRows - previousTranscriptRows;
				layout = layoutFullscreenLines(lines, marker, this.terminal.rows, width, scrollOffset) ?? layout;
			}
			scrollOffset = layout.scrollOffset;
			maxScrollOffset = layout.maxScrollOffset;
			viewportRows = layout.viewportRows;
			previousTranscriptRows = layout.transcriptRows;
			return layout.lines;
		}
		if (!cleanupIdleStatus) return lines;

		const cleaned = stripMountedIdleStatus(lines, width);
		if (cleaned === lines) {
			cleanupIdleStatus = false;
			if (this.render === wrappedRender) this.render = originalRender;
		}
		return cleaned;
	};

	const requestNormalBufferRender = (): void => {
		const terminal = tui.terminal;
		const originalWrite = terminal.write;
		let pending = true;
		const filteredWrite = function (this: typeof terminal, data: string): void {
			let output = data;
			if (pending && output.includes("\x1b[2J\x1b[H\x1b[3J")) {
				pending = false;
				output = output.replace("\x1b[2J\x1b[H\x1b[3J", "\x1b[2J\x1b[H");
				if (terminal.write === filteredWrite) terminal.write = originalWrite;
			}
			originalWrite.call(terminal, output);
		};
		terminal.write = filteredWrite;
		try {
			tui.requestRender(true);
		} catch (error) {
			pending = false;
			if (terminal.write === filteredWrite) terminal.write = originalWrite;
			throw error;
		}
	};

	return {
		marker,
		get active() {
			return enabled;
		},
		enable() {
			if (enabled) return;
			scrollOffset = 0;
			maxScrollOffset = 0;
			viewportRows = 0;
			previousTranscriptRows = undefined;
			enabled = true;
			tui.render = wrappedRender;
			tui.setClearOnShrink(true);
			try {
				enteredAlternateScreen = true;
				tui.terminal.write(ALT_SCREEN_ENTER);
				mouseReportingEnabled = true;
				tui.terminal.write(MOUSE_REPORTING_ENABLE);
				tui.requestRender(true);
			} catch (error) {
				enabled = false;
				if (tui.render === wrappedRender) tui.render = originalRender;
				tui.setClearOnShrink(previousClearOnShrink);
				if (mouseReportingEnabled) {
					mouseReportingEnabled = false;
					try {
						tui.terminal.write(MOUSE_REPORTING_DISABLE);
					} catch { /* preserve the activation failure */ }
				}
				if (enteredAlternateScreen) {
					enteredAlternateScreen = false;
					try {
						tui.terminal.write(ALT_SCREEN_LEAVE);
					} catch { /* preserve the activation failure */ }
				}
				throw error;
			}
		},
		scrollPage(direction) {
			if (!enabled || maxScrollOffset === 0) return false;
			const pageRows = Math.max(1, Math.floor(viewportRows / 2));
			const nextOffset = direction === "up"
				? Math.min(maxScrollOffset, scrollOffset + pageRows)
				: Math.max(0, scrollOffset - pageRows);
			if (nextOffset !== scrollOffset) {
				scrollOffset = nextOffset;
				tui.requestRender();
			}
			return true;
		},
		scrollWheel(direction) {
			if (!enabled || maxScrollOffset === 0) return;
			const nextOffset = direction === "up"
				? Math.min(maxScrollOffset, scrollOffset + 1)
				: Math.max(0, scrollOffset - 1);
			if (nextOffset !== scrollOffset) {
				scrollOffset = nextOffset;
				tui.requestRender();
			}
		},
		followBottom() {
			if (!enabled || scrollOffset === 0) return;
			scrollOffset = 0;
			tui.requestRender();
		},
		disable(options) {
			if (!enabled && !enteredAlternateScreen) return;
			let cleanupError: unknown;
			const restore = (action: () => void): void => {
				try {
					action();
				} catch (error) {
					cleanupError ??= error;
				}
			};
			enabled = false;
			cleanupIdleStatus = !previousClearOnShrink;
			if (!cleanupIdleStatus && tui.render === wrappedRender) tui.render = originalRender;
			tui.setClearOnShrink(previousClearOnShrink);
			if (mouseReportingEnabled) {
				mouseReportingEnabled = false;
				restore(() => tui.terminal.write(MOUSE_REPORTING_DISABLE));
			}
			if (enteredAlternateScreen) {
				enteredAlternateScreen = false;
				restore(() => tui.terminal.write(ALT_SCREEN_LEAVE));
			}
			// Force a clean normal-buffer repaint, but remove Pi's CSI 3J from that
			// one redraw so the shell scrollback restored by CSI ?1049l survives.
			restore(requestNormalBufferRender);
			if (options?.clearNormalBufferAfterRender) {
				// Shutdown handlers run sequentially and later extensions can request
				// another next-tick render. Clear in the following event-loop phase so
				// every queued repaint finishes before the shell-facing clean viewport.
				setImmediate(() => tui.terminal.write(NORMAL_SCREEN_CLEAR));
			}
			if (cleanupError) throw cleanupError;
		},
	};
}

function nextMarker(): string {
	markerSequence += 1;
	return `\x1b_pi:claudify-fullscreen:${markerSequence}\x07`;
}

function focusedComponent(tui: TUI): unknown {
	return (tui as unknown as { focusedComponent?: unknown }).focusedComponent;
}

function sgrMouseEvents(data: string): Array<"up" | "down" | "other"> | undefined {
	const pattern = /\x1b\[<(\d+);\d+;\d+([Mm])/g;
	const events: Array<"up" | "down" | "other"> = [];
	let offset = 0;
	for (let match = pattern.exec(data); match; match = pattern.exec(data)) {
		// Consume only when the ENTIRE terminal chunk is a sequence batch. Mixed
		// keyboard text must continue to the editor unchanged.
		if (match.index !== offset) return undefined;
		offset = pattern.lastIndex;
		const button = Number(match[1]) & ~0b11100;
		if (match[2] === "M" && button === 64) events.push("up");
		else if (match[2] === "M" && button === 65) events.push("down");
		else events.push("other");
	}
	return events.length > 0 && offset === data.length ? events : undefined;
}

export function registerFullscreenTui(pi: ExtensionAPI): void {
	let active: {
		controller: FullscreenController;
		clearWidget: () => void;
		removeInputListener: () => void;
	} | undefined;

	const disableActive = (options?: { clearNormalBufferAfterRender?: boolean }): boolean => {
		if (!active) return false;
		const current = active;
		active = undefined;
		try {
			current.removeInputListener();
		} catch { /* terminal restoration takes priority */ }
		try {
			current.controller.disable(options);
		} finally {
			current.clearWidget();
		}
		return true;
	};

	pi.registerCommand("tui", {
		description: "Toggle Claude Code-style fullscreen layout",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify("/tui needs the interactive TUI", "info");
				return;
			}

			if (active) {
				try {
					disableActive();
					ctx.ui.notify("Fullscreen TUI disabled", "info");
				} catch {
					ctx.ui.notify("Couldn't disable fullscreen TUI", "error");
				}
				return;
			}

			const marker = nextMarker();
			let tui: TUI | undefined;
			let controller: FullscreenController | undefined;
			let removeInputListener: (() => void) | undefined;
			const clearWidget = (): void => ctx.ui.setWidget(FULLSCREEN_WIDGET_KEY, undefined);
			try {
				ctx.ui.setWidget(FULLSCREEN_WIDGET_KEY, (capturedTui) => {
					tui = capturedTui;
					return createFullscreenMarker(marker);
				});
				controller = tui ? createFullscreenController(tui, marker) : undefined;
				if (!controller || !tui || typeof ctx.ui.onTerminalInput !== "function") {
					clearWidget();
					ctx.ui.notify("Fullscreen TUI is unavailable in this Pi version", "warning");
					return;
				}
				controller.enable();
				const editor = focusedComponent(tui);
				removeInputListener = ctx.ui.onTerminalInput((data) => {
					if (!active || active.controller !== controller || focusedComponent(tui!) !== editor) return undefined;
					if (matchesKey(data, "enter")) {
						controller!.followBottom();
						return undefined;
					}
					if (matchesKey(data, "pageUp")) {
						return controller!.scrollPage("up") ? { consume: true } : undefined;
					}
					if (matchesKey(data, "pageDown")) {
						return controller!.scrollPage("down") ? { consume: true } : undefined;
					}
					const mouseEvents = sgrMouseEvents(data);
					if (mouseEvents) {
						for (const mouseEvent of mouseEvents) {
							if (mouseEvent !== "other") controller!.scrollWheel(mouseEvent);
						}
						return { consume: true };
					}
					return undefined;
				});
				active = { controller, clearWidget, removeInputListener };
			} catch {
				active = undefined;
				try {
					removeInputListener?.();
				} catch { /* terminal restoration takes priority */ }
				try {
					controller?.disable();
				} catch { /* noop */ }
				clearWidget();
				ctx.ui.notify("Couldn't enable fullscreen TUI", "error");
				return;
			}
			ctx.ui.notify("Fullscreen TUI enabled", "info");
		},
	});

	pi.on("session_shutdown", (event) => {
		disableActive({ clearNormalBufferAfterRender: event.reason === "quit" });
	});
}
