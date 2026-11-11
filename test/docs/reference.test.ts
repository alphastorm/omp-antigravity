// Purpose: Keep the operator reference in docs/OPERATIONS.md true to the code.
// Responsibilities: The environment-variable table lists exactly the OMP_ANTIGRAVITY_* variables the
//   code reads, and every error message the page quotes is text the code can emit.
// Scope: Static comparison of docs/OPERATIONS.md with src/*.ts; no network.
// Usage: bun run test:docs
import { expect, test } from "bun:test";
import { read, ROOT, section } from "./repo.ts";

const SOURCE = [...new Bun.Glob("src/*.ts").scanSync({ cwd: ROOT })].sort().map(read).join("\n");
const OPERATIONS = read("docs/OPERATIONS.md");

/** The first cell of each body row of every table in `markdown`. */
function firstCells(markdown: string): string[] {
	return markdown
		.split(/\r?\n/)
		.filter(line => /^\|/.test(line) && !/^\|\s*:?-{3,}/.test(line))
		.map(line => line.split(/(?<!\\)\|/)[1]?.trim() ?? "")
		.filter(cell => cell !== "");
}

test("the environment-variable table lists exactly the variables the code reads", () => {
	const inCode = [...new Set(SOURCE.match(/\bOMP_ANTIGRAVITY_[A-Z_]+\b/g) ?? [])].sort();
	const documented = firstCells(section(OPERATIONS, "## Environment variables"))
		.map(cell => cell.match(/^`(OMP_ANTIGRAVITY_[A-Z_]+)`$/)?.[1])
		.filter(name => name !== undefined)
		.sort();
	expect(documented).toEqual(inCode);
});

test("every error message the reference quotes is text the code can emit", () => {
	// A cell may quote more than one message; `…` stands for a value the code interpolates.
	const quoted = firstCells(section(OPERATIONS, "## Error messages")).flatMap(cell =>
		[...cell.matchAll(/``(.+?)``|`([^`]+)`/g)].map(([, double, single]) => (double ?? single).trim()),
	);
	expect(quoted.length).toBeGreaterThan(0);
	const unknown = quoted.filter(message => {
		const pieces = message
			.split("…")
			.map(piece => piece.replace(/^[\s()"'.,;:]+|[\s()"'.,;:]+$/g, ""))
			.filter(piece => piece.length >= 6);
		return pieces.length === 0 || pieces.some(piece => !SOURCE.includes(piece));
	});
	expect(unknown).toEqual([]);
});
