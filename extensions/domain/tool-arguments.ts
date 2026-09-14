import { sanitizeToolText } from "../terminal-sanitize.ts";

export function getTextContent(result: any): string {
	if (!Array.isArray(result?.content)) return "";
	return result.content
		.filter((block: any) => block?.type === "text" && typeof block.text === "string")
		.map((block: any) => block.text)
		.join("\n");
}

export function getRawStringArg(args: any, ...keys: string[]): string {
	for (const key of keys) {
		const value = args?.[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

export function getStringArg(args: any, ...keys: string[]): string {
	return sanitizeToolText(getRawStringArg(args, ...keys));
}

export function getStringArrayArg(args: any, ...keys: string[]): string[] {
	for (const key of keys) {
		const value = args?.[key];
		if (!Array.isArray(value)) continue;
		const items = value
			.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
			.map((item) => sanitizeToolText(item.trim()));
		if (items.length > 0) return items;
	}
	return [];
}

export function extractApplyPatchFiles(patchText: string): string[] {
	if (!patchText) return [];
	const files = new Set<string>();
	for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
		const filePath = match[1]?.trim();
		if (filePath) files.add(filePath);
	}
	return [...files];
}
