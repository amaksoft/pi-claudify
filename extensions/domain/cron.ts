export interface CronTask {
	id: string;
	cron: string;
	prompt: string;
	createdAt: number;
	recurring: boolean;
	durable: boolean;
	nextRunAt: number;
}

interface CronField { values: ReadonlySet<number>; wildcard: boolean }
export interface ParsedCron { minute: CronField; hour: CronField; day: CronField; month: CronField; weekday: CronField }

const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const;

function parseField(source: string, min: number, max: number): CronField {
	const values = new Set<number>();
	const wildcard = source === "*";
	for (const part of source.split(",")) {
		const [rangeText, stepText] = part.split("/");
		const step = stepText === undefined ? 1 : Number(stepText);
		if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron field '${source}'.`);
		let start: number;
		let end: number;
		if (rangeText === "*") { start = min; end = max; }
		else if (rangeText.includes("-")) {
			if (!/^\d+-\d+$/.test(rangeText)) throw new Error(`Invalid cron field '${source}'.`);
			const pair = rangeText.split("-").map(Number);
			if (pair.length !== 2 || pair.some((value) => !Number.isInteger(value))) throw new Error(`Invalid cron field '${source}'.`);
			[start, end] = pair;
		} else {
			start = end = Number(rangeText);
		}
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
			throw new Error(`Invalid cron field '${source}'. Expected ${min}-${max}.`);
		}
		for (let value = start; value <= end; value += step) values.add(value);
	}
	if (values.size === 0) throw new Error(`Invalid cron field '${source}'.`);
	return { values, wildcard };
}

export function parseCron(expression: string): ParsedCron {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) throw new Error(`Invalid cron expression '${expression}'. Expected 5 fields: M H DoM Mon DoW.`);
	return {
		minute: parseField(fields[0], ...RANGES[0]),
		hour: parseField(fields[1], ...RANGES[1]),
		day: parseField(fields[2], ...RANGES[2]),
		month: parseField(fields[3], ...RANGES[3]),
		weekday: parseField(fields[4], ...RANGES[4]),
	};
}

export function cronMatches(parsed: ParsedCron, date: Date): boolean {
	if (!parsed.minute.values.has(date.getMinutes()) || !parsed.hour.values.has(date.getHours()) || !parsed.month.values.has(date.getMonth() + 1)) return false;
	const dayMatches = parsed.day.values.has(date.getDate());
	const weekdayMatches = parsed.weekday.values.has(date.getDay());
	return parsed.day.wildcard ? weekdayMatches : parsed.weekday.wildcard ? dayMatches : dayMatches || weekdayMatches;
}

function nextValue(values: ReadonlySet<number>, current: number): number | undefined {
	return [...values].sort((a, b) => a - b).find((value) => value > current);
}

export function nextCronTime(expression: string, afterMs: number, maxMinutes = 60 * 24 * 366 * 5): number {
	const parsed = parseCron(expression);
	const cursor = new Date(afterMs);
	cursor.setSeconds(0, 0);
	cursor.setMinutes(cursor.getMinutes() + 1);
	const deadline = cursor.getTime() + maxMinutes * 60_000;
	while (cursor.getTime() <= deadline) {
		if (!parsed.month.values.has(cursor.getMonth() + 1)) {
			cursor.setMonth(cursor.getMonth() + 1, 1);
			cursor.setHours(0, 0, 0, 0);
			continue;
		}
		const dayMatches = parsed.day.values.has(cursor.getDate());
		const weekdayMatches = parsed.weekday.values.has(cursor.getDay());
		const validDay = parsed.day.wildcard ? weekdayMatches : parsed.weekday.wildcard ? dayMatches : dayMatches || weekdayMatches;
		if (!validDay) {
			cursor.setDate(cursor.getDate() + 1);
			cursor.setHours(0, 0, 0, 0);
			continue;
		}
		if (!parsed.hour.values.has(cursor.getHours())) {
			const hour = nextValue(parsed.hour.values, cursor.getHours());
			if (hour !== undefined) cursor.setHours(hour, 0, 0, 0);
			else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(0, 0, 0, 0); }
			continue;
		}
		if (!parsed.minute.values.has(cursor.getMinutes())) {
			const minute = nextValue(parsed.minute.values, cursor.getMinutes());
			if (minute !== undefined) cursor.setMinutes(minute, 0, 0);
			else { cursor.setHours(cursor.getHours() + 1, 0, 0, 0); }
			continue;
		}
		if (cronMatches(parsed, cursor)) return cursor.getTime();
		cursor.setMinutes(cursor.getMinutes() + 1);
	}
	throw new Error(`Cron expression '${expression}' has no occurrence in the supported scheduling window.`);
}

function clock(hour: number, minute: number): string {
	const suffix = hour >= 12 ? "PM" : "AM";
	const displayHour = hour % 12 || 12;
	return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function humanCron(expression: string): string {
	const fields = expression.trim().split(/\s+/);
	parseCron(expression);
	const [minute, hour, day, month, weekday] = fields;
	const everyMinutes = /^\*\/(\d+)$/.exec(minute);
	if (everyMinutes && hour === "*" && day === "*" && month === "*" && weekday === "*") {
		const count = Number(everyMinutes[1]);
		return `Every ${count} ${count === 1 ? "minute" : "minutes"}`;
	}
	if (/^\d+$/.test(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*") {
		return `Every hour at :${String(Number(minute)).padStart(2, "0")}`;
	}
	if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === "*" && month === "*" && weekday === "*") {
		return `Every day at ${clock(Number(hour), Number(minute))}`;
	}
	return expression.trim();
}

export function formatCronList(tasks: readonly CronTask[]): string {
	if (tasks.length === 0) return "No scheduled jobs.";
	return tasks.map((task) => `${task.id} — ${humanCron(task.cron)} (${task.recurring ? "recurring" : "one-shot"})${task.durable ? "" : " [session-only]"}: ${task.prompt}`).join("\n");
}
