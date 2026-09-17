import bashLanguage from "@shikijs/langs/bash";
import cLanguage from "@shikijs/langs/c";
import cppLanguage from "@shikijs/langs/cpp";
import csharpLanguage from "@shikijs/langs/csharp";
import cssLanguage from "@shikijs/langs/css";
import dartLanguage from "@shikijs/langs/dart";
import goLanguage from "@shikijs/langs/go";
import graphqlLanguage from "@shikijs/langs/graphql";
import htmlLanguage from "@shikijs/langs/html";
import javaLanguage from "@shikijs/langs/java";
import javascriptLanguage from "@shikijs/langs/javascript";
import jsonLanguage from "@shikijs/langs/json";
import jsxLanguage from "@shikijs/langs/jsx";
import kotlinLanguage from "@shikijs/langs/kotlin";
import luaLanguage from "@shikijs/langs/lua";
import markdownLanguage from "@shikijs/langs/markdown";
import phpLanguage from "@shikijs/langs/php";
import pythonLanguage from "@shikijs/langs/python";
import rubyLanguage from "@shikijs/langs/ruby";
import rustLanguage from "@shikijs/langs/rust";
import scssLanguage from "@shikijs/langs/scss";
import sqlLanguage from "@shikijs/langs/sql";
import svelteLanguage from "@shikijs/langs/svelte";
import swiftLanguage from "@shikijs/langs/swift";
import tomlLanguage from "@shikijs/langs/toml";
import tsxLanguage from "@shikijs/langs/tsx";
import typescriptLanguage from "@shikijs/langs/typescript";
import vueLanguage from "@shikijs/langs/vue";
import xmlLanguage from "@shikijs/langs/xml";
import yamlLanguage from "@shikijs/langs/yaml";
import monokaiTheme from "@shikijs/themes/monokai";
import { getSingletonHighlighter, type BundledLanguage, type BundledTheme } from "shiki";

import { debugDiagnostic } from "../debug.ts";
import { hexToFgAnsi } from "../domain/color-math.ts";
import { claudeDiffLightMode, DIFF_THEME, FG_SAFE_MUTED } from "../domain/diff-palette.ts";
import { readSettings } from "../settings.ts";

export type { BundledLanguage, BundledTheme };

// ---------------------------------------------------------------------------
// Shiki loading, caching, and ANSI token conversion for the diff renderer.
//
// Pi's extension sandbox cannot resolve Shiki's hidden dynamic theme/language
// imports. Languages/themes are statically declared here and the highlighter
// is initialized lazily on first use. Shiki still owns parsing, scopes, and
// token colors; this module only serializes the returned tokens as SGR,
// replacing @shikijs/cli's tiny ANSI adapter.
// ---------------------------------------------------------------------------

const SHIKI_LANGUAGES = [
	bashLanguage, cLanguage, cppLanguage, csharpLanguage, cssLanguage, dartLanguage,
	goLanguage, graphqlLanguage, htmlLanguage, javaLanguage, javascriptLanguage,
	jsonLanguage, jsxLanguage, kotlinLanguage, luaLanguage, markdownLanguage,
	phpLanguage, pythonLanguage, rubyLanguage, rustLanguage, scssLanguage,
	sqlLanguage, svelteLanguage, swiftLanguage, tomlLanguage, tsxLanguage,
	typescriptLanguage, vueLanguage, xmlLanguage, yamlLanguage,
];
let shikiHighlighterLoader: Promise<any> | null = null;

export const MAX_HL_CHARS = 32_000;
const CACHE_LIMIT = 48;

interface ShikiAnsiToken {
	content: string;
	color?: string;
	explanation?: Array<{ scopes?: Array<{ scopeName?: string }> }>;
}

function tokenHasScope(token: ShikiAnsiToken, fragment: string): boolean {
	return token.explanation?.some((part) => part.scopes?.some((scope) => scope.scopeName?.includes(fragment))) === true;
}

function shikiTokenAnsi(token: ShikiAnsiToken, colorOverride: string | undefined, lightMode: boolean): string {
	let color = (colorOverride ?? token.color)?.slice(0, 7).toLowerCase();
	const isMonokaiOperator = color === "#f92672" && /^[^\p{L}\p{N}_$]+$/u.test(token.content);
	if (isMonokaiOperator || color === "#f8f8f2") color = "#ffffff";
	if (lightMode) {
		const lightColors: Record<string, string> = {
			"#ffffff": "#303030",
			"#66d9ef": "#af005f",
			"#ae81ff": "#0087af",
			"#e6db74": "#005f87",
			"#a6e22e": "#875faf",
			"#f92672": "#af005f",
		};
		color = color ? lightColors[color] ?? color : color;
	}
	const fg = color ? hexToFgAnsi(color) : "";
	// Claude's edit capture uses Monokai token colors without Monokai's optional
	// italic keyword font style. Reset only foreground: 0m/49m would punch holes
	// in the green row background between adjacent tokens.
	return `${fg}${token.content}\x1b[39m`;
}

function shikiLineAnsi(tokens: ShikiAnsiToken[], language: BundledLanguage, lightMode: boolean): string {
	return tokens.map((token, index) => {
		let color: string | undefined;
		if (language === "json") {
			const following = tokens.slice(index + 1).map((item) => item.content).join("").trimStart();
			if (/^"[\s\S]*"$/.test(token.content.trim()) && following.startsWith(":")) color = "#a6e22e";
			else if (/^(?:true|false|null)$/.test(token.content.trim())) color = "#f92672";
		}
		if (language === "python" && tokenHasScope(token, "support.function.builtin")) color = "#a6e22e";
		return shikiTokenAnsi(token, color, lightMode);
	}).join("");
}

async function codeToAnsiLazy(code: string, language: BundledLanguage, theme: BundledTheme, lightMode: boolean): Promise<string> {
	if (theme !== "monokai") {
		throw new Error(`Unsupported dynamically-loaded Shiki theme: ${theme}`);
	}
	shikiHighlighterLoader ??= getSingletonHighlighter({
		themes: [monokaiTheme],
		langs: SHIKI_LANGUAGES as any,
	});
	const highlighter = await shikiHighlighterLoader;
	const lines = highlighter.codeToTokensBase(code, {
		lang: language,
		theme: "monokai",
		includeExplanation: language === "python",
	});
	return lines.map((line: ShikiAnsiToken[]) => shikiLineAnsi(line, language, lightMode)).join("\n");
}

const hlCache = new Map<string, string[]>();

export function clearHighlightCache(): void {
	hlCache.clear();
}

function touchCache(key: string, value: string[]): string[] {
	hlCache.delete(key);
	hlCache.set(key, value);
	while (hlCache.size > CACHE_LIMIT) {
		const first = hlCache.keys().next().value;
		if (first === undefined) break;
		hlCache.delete(first);
	}
	return value;
}

export function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(/\x1b\[([0-9;]*)m/g, (seq, params: string) => {
		if (params === "30" || params === "90" || params === "38;5;0" || params === "38;5;8") return FG_SAFE_MUTED;
		if (!params.startsWith("38;2;")) return seq;
		const parts = params.split(";").map(Number);
		if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return seq;
		const [, , r, g, b] = parts;
		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		return luminance < 72 ? FG_SAFE_MUTED : seq;
	});
}

export async function hlBlock(code: string, language: BundledLanguage | undefined): Promise<string[]> {
	if (!code) return [""];
	if (readSettings().values.diffSyntaxHighlighting === false) return code.split("\n");
	if (!language || code.length > MAX_HL_CHARS) return code.split("\n");
	const lightMode = claudeDiffLightMode;
	const themeName = DIFF_THEME;
	const key = `${themeName}\0${lightMode ? "light" : "dark"}\0${language}\0${code}`;
	const hit = hlCache.get(key);
	if (hit) return touchCache(key, hit);
	try {
		const highlighted = await codeToAnsiLazy(code, language, themeName, lightMode);
		const ansi = lightMode ? highlighted : normalizeShikiContrast(highlighted);
		const out = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split("\n");
		return touchCache(key, out);
	} catch (error) {
		debugDiagnostic("syntax-highlight", error, String(language));
		return code.split("\n");
	}
}
