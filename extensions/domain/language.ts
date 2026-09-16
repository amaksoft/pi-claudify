import type { BundledLanguage } from "shiki";

const EXTENSION_LANGUAGES: Record<string, BundledLanguage> = {
	ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
	py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
	cs: "csharp", swift: "swift", kt: "kotlin", html: "html", css: "css", scss: "scss", json: "json",
	yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown", sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
	lua: "lua", php: "php", dart: "dart", xml: "xml", graphql: "graphql", svelte: "svelte", vue: "vue",
};

export function languageForPath(filePath: string): BundledLanguage | undefined {
	const base = filePath.split(/[\\/]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	const extension = dot >= 0 ? base.slice(dot + 1).toLowerCase() : base.toLowerCase();
	return EXTENSION_LANGUAGES[extension];
}
