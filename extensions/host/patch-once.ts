export function patchMethodOnce(
	target: any,
	flag: symbol,
	method: string,
	wrap: (original: Function) => Function,
): boolean {
	if (!target || target[flag]) return false;
	const original = target[method];
	if (typeof original !== "function") return false;
	target[method] = wrap(original);
	target[flag] = true;
	return true;
}
