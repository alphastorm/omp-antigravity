#!/usr/bin/env bun
// End-to-end smoke through a real OMP and the signed-in `agy`: text, an OMP tool round trip, and
// images in both directions. Runs one OMP process at a time with tiny prompts, and stops at the
// first failure (a rate-limit notice included) instead of retrying.
//
//   bun test/live/smoke.ts                                   # gemini-3.8-flash at low effort
//   SMOKE_MODEL=gemini-4-carbon SMOKE_EFFORT=medium bun test/live/smoke.ts
//   OMP_BIN=/path/to/omp bun test/live/smoke.ts               # default: first `omp` on PATH outside node_modules
//
// Effort goes through `--thinking`: OMP 18.18.3 resolves a suffixed `--model provider/id:effort` before
// extensions register their providers, so it rejects that form for this provider.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bandsPng } from "../fixtures/png.ts";

const extension = resolve(import.meta.dir, "../../src/index.ts");
const model = `antigravity-acp/${process.env.SMOKE_MODEL ?? "gemini-3.8-flash"}`;
const effort = process.env.SMOKE_EFFORT ?? "low";
const searchPath = (process.env.PATH ?? "")
	.split(":")
	.filter(dir => !dir.includes("node_modules"))
	.join(":");
const omp = process.env.OMP_BIN ?? Bun.which("omp", { PATH: searchPath });
if (!omp) throw new Error("omp not found on PATH; set OMP_BIN");

const dir = mkdtempSync(join(tmpdir(), "omp-antigravity-smoke-"));
// Failures leave the ACP updates and tool traffic for diagnosis (docs/OPERATIONS.md "Debug traces").
const debugDir = process.env.OMP_ANTIGRAVITY_DEBUG ?? join(dir, "debug");
const nonce = `NONCE-${crypto.randomUUID().slice(0, 8)}`;
writeFileSync(join(dir, "note.txt"), `${nonce}\n`);
writeFileSync(join(dir, "bands.png"), bandsPng(96, 48, [[220, 30, 30], [30, 60, 220]]));

const cases: { name: string; args: string[]; expect: RegExp }[] = [
	{ name: "text", args: ["--no-tools", "Reply with the single word PONG."], expect: /\bPONG\b/ },
	{
		name: "tool round trip",
		// Asks for the token by its prefix, not its position: agy puts `Created At:` and `Completed At:` lines
		// ahead of an inline tool result, and a model asked for "the first line" can answer with that line.
		args: ["--tools", "read", "Use the read tool on note.txt in the current directory, then reply with only the token in it that starts with NONCE-."],
		expect: new RegExp(nonce),
	},
	{
		name: "tool-returned image",
		args: ["--tools", "read", "Use the read tool on bands.png. Name its two colours, left then right, as two lowercase words."],
		expect: /red\W+blue/i,
	},
	{
		name: "prompt image",
		args: ["--no-tools", "@bands.png", "Name this image's two colours, left then right, as two lowercase words."],
		expect: /red\W+blue/i,
	},
];

let failed = false;
for (const { name, args, expect } of cases) {
	const started = performance.now();
	const proc = Bun.spawn(
		[omp, "-p", "--no-session", "--no-extensions", "--no-skills", "-e", extension, "--model", model, "--thinking", effort, "--system-prompt", "You are terse.", ...args],
		{ cwd: dir, stdout: "pipe", stderr: "pipe", timeout: 180_000, env: { ...process.env, OMP_ANTIGRAVITY_DEBUG: debugDir } },
	);
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	await proc.exited;
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	const text = `${out}\n${err}`.trim();
	const ok = proc.exitCode === 0 && expect.test(out);
	console.log(`${ok ? "PASS" : "FAIL"} ${name} (${seconds}s)${ok ? "" : `\n${text.slice(-1200)}`}`);
	if (!ok) {
		failed = true;
		break;
	}
}
console.log(`${model} at ${effort} via ${omp}; workdir ${dir}`);
process.exit(failed ? 1 : 0);
