export interface BashDisplayInfo {
	kind: "read";
	label: "Read";
	path: string;
	rangeLabel?: string;
	suppressCollapsedHint: boolean;
}

export function tokenizeShellCommand(command: string): string[] | null {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;
	const push = () => { if (current.length > 0) { tokens.push(current); current = ""; } };
	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (escaping) { current += char; escaping = false; continue; }
		if (quote) {
			if (char === quote) { quote = null; continue; }
			if (quote === '"' && char === "\\") { escaping = true; continue; }
			current += char;
			continue;
		}
		if (char === "\\") { escaping = true; continue; }
		if (char === "'" || char === '"') { quote = char; continue; }
		if (/\s/.test(char)) { push(); continue; }
		if (char === "|" || char === ";") {
			push();
			if (char === "|" && command[index + 1] === "|") { tokens.push("||"); index++; }
			else tokens.push(char);
			continue;
		}
		if (char === "&" && command[index + 1] === "&") { push(); tokens.push("&&"); index++; continue; }
		current += char;
	}
	if (escaping) current += "\\";
	if (quote) return null;
	push();
	return tokens;
}

function isControlToken(token: string): boolean { return token === "&&" || token === "||" || token === ";"; }
function isOptionToken(token: string): boolean { return token.startsWith("-") && token !== "-" && token !== "--"; }
function singlePathArg(tokens: readonly string[]): string | null {
	const paths = tokens.filter((token) => token !== "--" && token !== "-" && !isOptionToken(token));
	return paths.length === 1 ? paths[0] : null;
}
function formatSedRangeLabel(script: string | undefined): string | undefined {
	if (!script) return undefined;
	const match = script.match(/^(\d+|\$)(?:,(\d+|\$))?p$/);
	if (!match) return undefined;
	return !match[2] || match[2] === match[1] ? `line ${match[1]}` : `lines ${match[1]}-${match[2]}`;
}
function parseSedPrintRange(tokens: readonly string[]): string | undefined {
	for (let index = 0; index < tokens.length; index++) {
		if (tokens[index] === "-n" && tokens[index + 1]) {
			const label = formatSedRangeLabel(tokens[index + 1]);
			if (label) return label;
		}
		const direct = formatSedRangeLabel(tokens[index]);
		if (direct) return direct;
	}
	return undefined;
}
function classifyNlRead(tokens: readonly string[]): BashDisplayInfo | null {
	const pipeIndex = tokens.indexOf("|");
	const left = pipeIndex === -1 ? tokens : tokens.slice(0, pipeIndex);
	if (left[0] !== "nl") return null;
	const path = singlePathArg(left.slice(1));
	if (!path) return null;
	let rangeLabel: string | undefined;
	if (pipeIndex !== -1) {
		const right = tokens.slice(pipeIndex + 1);
		if (right[0] !== "sed" || right.includes("|")) return null;
		rangeLabel = parseSedPrintRange(right);
	}
	return { kind: "read", label: "Read", path, rangeLabel, suppressCollapsedHint: true };
}
function classifySedRead(tokens: readonly string[]): BashDisplayInfo | null {
	if (tokens[0] !== "sed") return null;
	const rangeLabel = parseSedPrintRange(tokens);
	if (!rangeLabel) return null;
	const scriptIndex = tokens.findIndex((token) => formatSedRangeLabel(token) !== undefined);
	const path = singlePathArg(tokens.slice(scriptIndex + 1));
	return path ? { kind: "read", label: "Read", path, rangeLabel, suppressCollapsedHint: true } : null;
}
function classifyCatRead(tokens: readonly string[]): BashDisplayInfo | null {
	if (tokens[0] !== "cat") return null;
	const path = singlePathArg(tokens.slice(1));
	return path ? { kind: "read", label: "Read", path, suppressCollapsedHint: true } : null;
}
function classifyHeadTailRead(tokens: readonly string[]): BashDisplayInfo | null {
	const command = tokens[0];
	if (command !== "head" && command !== "tail") return null;
	let count: string | undefined;
	const paths: string[] = [];
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--") continue;
		if (token === "-n" && tokens[index + 1]) { count = tokens[++index]; continue; }
		const compact = token.match(/^-(\d+)$/)?.[1];
		if (compact) { count = compact; continue; }
		if (!isOptionToken(token)) paths.push(token);
	}
	if (paths.length !== 1) return null;
	const amount = count && /^\d+$/.test(count) ? count : "10";
	return { kind: "read", label: "Read", path: paths[0], rangeLabel: `${command === "head" ? "first" : "last"} ${amount} lines`, suppressCollapsedHint: true };
}

export function classifyBashCommandForDisplay(command: string): BashDisplayInfo | null {
	const tokens = tokenizeShellCommand(command.trim());
	if (!tokens || tokens.length === 0 || tokens.some(isControlToken)) return null;
	return classifyNlRead(tokens) ?? classifySedRead(tokens) ?? classifyCatRead(tokens) ?? classifyHeadTailRead(tokens);
}

export function emptyBashResultLabel(command: string): "Done" | "(No output)" {
	const tokens = tokenizeShellCommand(command.trim());
	return tokens && ["cd", "touch", "mkdir", "rm"].includes(tokens[0] ?? "") ? "Done" : "(No output)";
}
