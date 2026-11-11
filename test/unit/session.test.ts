// State-machine tests against a scripted fake `agy acp` (test/fixtures/fake-agy.ts). No network.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	ProviderSessionState,
	SimpleStreamOptions,
	Tool,
	ToolResultMessage,
} from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";

const home = mkdtempSync(join(tmpdir(), "omp-ag-test-"));
const logFile = join(home, "fake.log");
process.env.OMP_ANTIGRAVITY_AGY = join(import.meta.dir, "..", "fixtures", "fake-agy");
process.env.OMP_ANTIGRAVITY_HOME = home;
process.env.OMP_ANTIGRAVITY_DEFER_MS = "1500";
process.env.OMP_ANTIGRAVITY_IDLE_TIMEOUT_MS = "2000";
process.env.OMP_ANTIGRAVITY_ENV_PASSTHROUGH =
	"FAKE_AGY_LOG,FAKE_AGY_DEFAULT_AGENT,FAKE_AGY_COMMANDS_DELAY_MS,FAKE_AGY_SEED,FAKE_AGY_INIT_DELAY_MS,FAKE_AGY_STUBBORN,FAKE_AGY_WORKER";
process.env.FAKE_AGY_LOG = logFile;
// The cleanup under test is skipped when debug capture is on.
delete process.env.OMP_ANTIGRAVITY_DEBUG;
// Dynamic import: the module reads OMP_ANTIGRAVITY_* settings at load, so the env above must exist first.
const { Runtime } = await import("../../src/session.ts");

/** Awaits a condition owned by real child processes (the fake agy), with a bounded deadline. */
async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("condition not met in time");
		await Bun.sleep(25);
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** The fake agy reads its knobs when it is spawned: set them only around the request that spawns it. */
async function withEnv<T>(env: Record<string, string>, work: () => Promise<T>): Promise<T> {
	Object.assign(process.env, env);
	try {
		return await work();
	} finally {
		for (const key of Object.keys(env)) delete process.env[key];
	}
}

/** About 250 KB: delivered as one acknowledgement-only context part and one final part. */
const bulk = Array.from({ length: 5000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");

const model = {
	id: "gemini-test",
	name: "Gemini Test",
	api: "antigravity-acp",
	provider: "antigravity-acp",
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 100_000,
	maxTokens: 8000,
} as unknown as Model;

const tool = (name: string): Tool => ({
	name,
	description: `${name} tool`,
	parameters: { type: "object", properties: { path: { type: "string" }, n: { type: "number" } } },
});
const tools = [tool("read"), tool("grep"), tool("slowtool")];

let clock = 1000;
const user = (text: string): Message => ({ role: "user", content: text, timestamp: clock++ });
const result = (call: { id: string; name: string }, text: string): ToolResultMessage => ({
	role: "toolResult",
	toolCallId: call.id,
	toolName: call.name,
	content: [{ type: "text", text }],
	isError: false,
	timestamp: clock++,
});

interface Outcome {
	message: AssistantMessage;
	text: string;
	calls: { id: string; name: string; arguments: Record<string, unknown> }[];
}

interface RunOptions {
	sessionId?: string;
	/** Send no session id at all, as OMP's one-shot completions do. */
	ephemeral?: boolean;
	state?: Map<string, ProviderSessionState>;
	signal?: AbortSignal;
	onPayload?: SimpleStreamOptions["onPayload"];
}

async function run(runtime: InstanceType<typeof Runtime>, messages: Message[], options: RunOptions = {}): Promise<Outcome> {
	const stream = new AssistantMessageEventStream();
	const context: Context = { systemPrompt: ["You are a test agent."], messages, tools };
	const streamOptions: SimpleStreamOptions = {
		...(options.ephemeral ? {} : { sessionId: options.sessionId ?? "s1" }),
		providerSessionState: options.state ?? new Map(),
		signal: options.signal,
		onPayload: options.onPayload,
	};
	void runtime.stream(model, context, streamOptions, stream);
	let message: AssistantMessage | undefined;
	for await (const event of stream) {
		if (event.type === "done") message = event.message;
		if (event.type === "error") message = event.error;
	}
	if (!message) throw new Error("stream ended without a terminal event");
	return {
		message,
		text: message.content.map(b => (b.type === "text" ? b.text : "")).join(""),
		calls: message.content.flatMap(b => (b.type === "toolCall" ? [b] : [])),
	};
}

const fakeLog = (): { pid: number; method: string; text?: string; worker?: number }[] =>
	existsSync(logFile)
		? readFileSync(logFile, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(l => JSON.parse(l))
		: [];
const count = (method: string, since = 0) => fakeLog().slice(since).filter(e => e.method === method).length;

let runtime: InstanceType<typeof Runtime>;
beforeAll(() => {
	runtime = new Runtime();
});
afterAll(async () => {
	await runtime.closeAll("test done");
	rmSync(home, { recursive: true, force: true });
});

describe("tool continuation", () => {
	test("small result resolves the parked call inside the same Antigravity turn", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const history: Message[] = [user('read it #fake:call read {"path":"a.txt"}')];
		const first = await run(runtime, history, { sessionId: "inline", state });
		expect(first.message.stopReason).toBe("toolUse");
		expect(first.calls).toEqual([{ type: "toolCall", id: expect.any(String), name: "read", arguments: { path: "a.txt" } }] as never);
		history.push(first.message, result(first.calls[0], "file A contents"));
		const second = await run(runtime, history, { sessionId: "inline", state });
		expect(second.message.stopReason).toBe("stop");
		expect(second.text).toBe("result:15:file A contents");
		expect(count("session/new", mark)).toBe(1);
		expect(count("session/prompt", mark)).toBe(1);
	});

	test("an oversized result travels as the next prompt, whole, instead of being clipped", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const history: Message[] = [user('#fake:call read {"path":"big"}')];
		const first = await run(runtime, history, { sessionId: "large", state });
		history.push(first.message, result(first.calls[0], `${"x".repeat(20_000)}\nTAIL-MARKER`));
		const second = await run(runtime, history, { sessionId: "large", state });
		expect(second.message.stopReason).toBe("stop");
		expect(second.text).toMatch(/^delivered len=\d+ tail=yes$/);
		expect(count("session/cancel", mark)).toBe(1);
		expect(count("session/prompt", mark)).toBe(2);
		expect(count("session/new", mark)).toBe(1);
	});

	test("parallel calls are batched and resolved by id regardless of result order", async () => {
		const state = new Map<string, ProviderSessionState>();
		const history: Message[] = [user("#fake:calls2 read,grep")];
		const first = await run(runtime, history, { sessionId: "parallel", state });
		expect(first.calls.map(c => c.name).sort()).toEqual(["grep", "read"]);
		const byName = Object.fromEntries(first.calls.map(c => [c.name, c]));
		history.push(first.message, result(byName.grep, "G-result"), result(byName.read, "R-result"));
		const second = await run(runtime, history, { sessionId: "parallel", state });
		expect(second.text).toBe("results:R-result|G-result");
	});

	test("a request that no longer matches the parked calls rebuilds from the OMP transcript", async () => {
		const state = new Map<string, ProviderSessionState>();
		const history: Message[] = [user('#fake:call read {"path":"x"}')];
		const first = await run(runtime, history, { sessionId: "rebuild", state });
		const mark = fakeLog().length;
		history.push(first.message, user("never mind, just say hi"));
		const second = await run(runtime, history, { sessionId: "rebuild", state });
		expect(second.message.stopReason).toBe("stop");
		expect(count("session/new", mark)).toBe(1);
		const cold = fakeLog().slice(mark).find(e => e.method === "session/prompt");
		expect(cold?.text).toContain("[OMP history");
		expect(cold?.text).toContain("→ called read");
		expect(runtime.recentRebuilds().at(-1)?.reason).toContain("missing results");
	});

	test("a tool that outlives the deferral window is delivered as a prompt after cancelling the turn", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const history: Message[] = [user('#fake:call slowtool {"n":1}')];
		const first = await run(runtime, history, { sessionId: "slow", state });
		// Real child process: the deferral fires after OMP_ANTIGRAVITY_DEFER_MS=1500 set above.
		await waitFor(() => count("session/cancel", mark) === 1);
		history.push(first.message, result(first.calls[0], "slow result TAIL-MARKER"));
		const second = await run(runtime, history, { sessionId: "slow", state });
		expect(second.text).toMatch(/tail=yes/);
	});

	test("a call that reaches the bridge after the batch closed is reported as not run when results travel as a prompt", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const history: Message[] = [user('#fake:calls2 read,grep {"gapMs":400}')];
		const first = await run(runtime, history, { sessionId: "late", state });
		expect(first.calls.map(c => c.name)).toEqual(["read"]);
		await waitFor(() => runtime.snapshot().find(s => s.key === "late")?.late === 1);
		history.push(first.message, result(first.calls[0], `${"x".repeat(20_000)}\nTAIL-MARKER`));
		const second = await run(runtime, history, { sessionId: "late", state });
		expect(second.text).toMatch(/tail=yes/);
		const delivery = fakeLog().slice(mark).findLast(e => e.method === "session/prompt");
		expect(delivery?.text).toContain('### Not run: grep({"n":2})');
	});
});

describe("guards and lifecycle", () => {
	test("a native tool attempt fails the turn and the next request rebuilds", async () => {
		const out = await run(runtime, [user("#fake:native")], { sessionId: "native" });
		expect(out.message.stopReason).toBe("error");
		expect(out.message.errorMessage).toContain("non-OMP tool (run_command)");
	});

	test("an OMP abort cancels the Antigravity turn and the session serves the next request", async () => {
		const state = new Map<string, ProviderSessionState>();
		const controller = new AbortController();
		const mark = fakeLog().length;
		const history: Message[] = [user("#fake:wait")];
		const pending = run(runtime, history, { sessionId: "abort", state, signal: controller.signal });
		await waitFor(() => count("session/prompt", mark) === 1);
		controller.abort();
		const aborted = await pending;
		expect(aborted.message.stopReason).toBe("aborted");
		await waitFor(() => count("session/cancel", mark) === 1);
		history.push(aborted.message, user("hello again"));
		const next = await run(runtime, history, { sessionId: "abort", state });
		expect(next.message.stopReason).toBe("stop");
		expect(count("session/new", mark)).toBe(1);
	});

	test("the first rate-limit notice cancels the turn with a 429, and OMP's retry re-asks in place", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const history: Message[] = [user("#fake:ratelimit")];
		const out = await run(runtime, history, { sessionId: "ratelimit", state });
		expect(out.message.stopReason).toBe("error");
		expect(out.message.errorStatus).toBe(429);
		expect(out.text).not.toContain("API error");
		await waitFor(() => count("session/cancel", mark) === 1);
		// OMP's retry drops the failed message and sends the same context again.
		const retried = await run(runtime, history, { sessionId: "ratelimit", state });
		expect(retried.message.stopReason).toBe("stop");
		expect(count("session/new", mark)).toBe(1);
		const prompts = fakeLog().slice(mark).filter(e => e.method === "session/prompt");
		expect(prompts.at(-1)?.text).toContain("[OMP retry]");
	});

	test("a default-agent fallback is refused before any prompt", async () => {
		process.env.FAKE_AGY_DEFAULT_AGENT = "1";
		try {
			const mark = fakeLog().length;
			const out = await run(runtime, [user("hello")], { sessionId: "fallback" });
			expect(out.message.errorMessage).toContain("restricted omp-host profile");
			expect(count("session/prompt", mark)).toBe(0);
		} finally {
			delete process.env.FAKE_AGY_DEFAULT_AGENT;
		}
	});

	test("a replayed context is refused without generating, and the session stays warm", async () => {
		const state = new Map<string, ProviderSessionState>();
		const history: Message[] = [user("hello")];
		const first = await run(runtime, history, { sessionId: "dup", state });
		expect(first.text).toBe("ok model=gemini-test effort=medium");
		history.push(first.message);
		const mark = fakeLog().length;
		const again = await run(runtime, history, { sessionId: "dup", state });
		expect(again.message.errorMessage).toContain("no messages Antigravity has not already answered");
		expect(count("session/prompt", mark)).toBe(0);
		history.push(user("and again"));
		const next = await run(runtime, history, { sessionId: "dup", state });
		expect(next.message.stopReason).toBe("stop");
		expect(count("session/new", mark)).toBe(0);
	});

	test("closing OMP's provider state releases a parked call, its process, and agy's transcript", async () => {
		const state = new Map<string, ProviderSessionState>();
		const first = await run(runtime, [user('#fake:call read {"path":"y"}')], { sessionId: "closing", state });
		expect(first.message.stopReason).toBe("toolUse");
		const live = runtime.snapshot().find(s => s.key === "closing");
		expect(live?.pid).toBeNumber();
		// agy's per-conversation files, plus another conversation's that must survive.
		const appData = join(home, "gemini", "antigravity-cli");
		const own = [join(appData, "brain", live!.acpSessionId, "logs"), join(appData, "conversations", `${live!.acpSessionId}.db`), join(appData, "annotations", `${live!.acpSessionId}.pbtxt`)];
		const other = join(appData, "conversations", "other-conversation.db");
		mkdirSync(own[0], { recursive: true });
		mkdirSync(join(appData, "conversations"), { recursive: true });
		mkdirSync(join(appData, "annotations"), { recursive: true });
		for (const file of [own[1], own[2], other]) writeFileSync(file, "x");
		state.get("antigravity-acp")?.close();
		await waitFor(() => !runtime.sessions.has("closing"));
		await waitFor(() => !alive(live!.pid));
		await waitFor(() => own.every(path => !existsSync(path)));
		expect(existsSync(other)).toBe(true);
	});

	test("an unsupported exact effort is rejected, not substituted", async () => {
		const stream = new AssistantMessageEventStream();
		// pi-ai types efforts as a const enum; the wire value is the plain string.
		const reasoning = "xhigh" as unknown as NonNullable<SimpleStreamOptions["reasoning"]>;
		void runtime.stream(model, { messages: [user("hi")], tools }, { sessionId: "effort", reasoning }, stream);
		const message = await stream.result().catch(e => e as AssistantMessage);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain('does not offer effort "xhigh"');
	});

	test("an abort before the prompt is sent does not count the transcript as delivered", async () => {
		const state = new Map<string, ProviderSessionState>();
		const controller = new AbortController();
		const mark = fakeLog().length;
		const history: Message[] = [user("FIRST-QUESTION")];
		// OMP's onPayload hook runs right before the adapter's last abort check.
		const aborted = await run(runtime, history, { sessionId: "unsent", state, signal: controller.signal, onPayload: () => void controller.abort() });
		expect(aborted.message.stopReason).toBe("aborted");
		expect(count("session/prompt", mark)).toBe(0);
		// Nothing can use that session again: its process does not wait for the next request or the idle TTL.
		const boot = fakeLog().slice(mark).find(e => e.method === "boot");
		await waitFor(() => boot !== undefined && !alive(boot.pid), 2000);
		history.push(aborted.message, user("SECOND-QUESTION"));
		const next = await run(runtime, history, { sessionId: "unsent", state });
		expect(next.message.stopReason).toBe("stop");
		const seen = fakeLog().slice(mark).filter(e => e.method === "session/prompt").map(e => e.text).join("");
		expect(seen).toContain("FIRST-QUESTION");
		expect(seen).toContain("SECOND-QUESTION");
	});

	test("an abort while context is still being delivered cancels that turn, and the next request replays all of it", async () => {
		const state = new Map<string, ProviderSessionState>();
		const controller = new AbortController();
		const mark = fakeLog().length;
		const history: Message[] = [user(`EARLY-MARKER\n${bulk}\nLATE-MARKER`)];
		process.env.FAKE_AGY_SEED = "wait";
		let aborted: Outcome;
		try {
			const pending = run(runtime, history, { sessionId: "seed-abort", state, signal: controller.signal });
			await waitFor(() => count("session/prompt", mark) === 1);
			controller.abort();
			aborted = await pending;
		} finally {
			delete process.env.FAKE_AGY_SEED;
		}
		expect(aborted.message.stopReason).toBe("aborted");
		expect(count("session/cancel", mark)).toBe(1);
		history.push(aborted.message, user("again"));
		const next = await run(runtime, history, { sessionId: "seed-abort", state });
		expect(next.message.stopReason).toBe("stop");
		expect(count("session/new", mark)).toBe(2);
		const replayed = fakeLog().slice(mark).filter(e => e.method === "session/prompt").slice(1).map(e => e.text).join("");
		expect(replayed).toContain("EARLY-MARKER");
		expect(replayed).toContain("LATE-MARKER");
	});

	test("a turn in which agy never emits anything fails at the idle timeout instead of hanging", async () => {
		const out = await run(runtime, [user("#fake:wait")], { sessionId: "stall" });
		expect(out.message.stopReason).toBe("error");
		expect(out.message.errorMessage).toContain("no Antigravity progress");
	});

	test("a default-agent command list that arrives late is still refused before any prompt", async () => {
		process.env.FAKE_AGY_DEFAULT_AGENT = "1";
		process.env.FAKE_AGY_COMMANDS_DELAY_MS = "300";
		try {
			const mark = fakeLog().length;
			const out = await run(runtime, [user("hello")], { sessionId: "late-fallback" });
			expect(out.message.errorMessage).toContain("restricted omp-host profile");
			expect(count("session/prompt", mark)).toBe(0);
		} finally {
			delete process.env.FAKE_AGY_DEFAULT_AGENT;
			delete process.env.FAKE_AGY_COMMANDS_DELAY_MS;
		}
	});

	test("closing the provider state while agy is still starting stops that process and sends nothing", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const pending = run(runtime, [user("hello")], { sessionId: "early-close", state });
		await waitFor(() => runtime.sessions.has("early-close"));
		state.get("antigravity-acp")?.close();
		const out = await pending;
		expect(out.message.stopReason).toBe("error");
		const since = fakeLog().slice(mark);
		expect(since.filter(e => e.method === "session/prompt")).toEqual([]);
		const boot = since.find(e => e.method === "boot");
		if (boot) await waitFor(() => !alive(boot.pid));
	});

	test("a request without a session id gives up its agy process when its stream ends, even at toolUse", async () => {
		const out = await run(runtime, [user('#fake:call read {"path":"e"}')], { ephemeral: true });
		expect(out.message.stopReason).toBe("toolUse");
		const live = runtime.snapshot().find(s => s.key.startsWith("ephemeral:"));
		expect(live?.pid).toBeNumber();
		await waitFor(() => !runtime.sessions.has(live!.key) && !alive(live!.pid), 3000);
	});

	test("shutdown kills an agy that is slow to exit, and its transcript, instead of orphaning both", async () => {
		process.env.FAKE_AGY_STUBBORN = "1";
		const own = new Runtime();
		try {
			await run(own, [user("hello")], { sessionId: "stubborn" });
			const live = own.snapshot()[0];
			const conversations = join(home, "gemini", "antigravity-cli", "conversations");
			const transcript = join(conversations, `${live.acpSessionId}.db`);
			mkdirSync(conversations, { recursive: true });
			writeFileSync(transcript, "x");
			// src/index.ts on session_shutdown: closeAll gets a moment, then killAll has to finish the job.
			const closing = own.closeAll("OMP shut down");
			own.killAll();
			await waitFor(() => !alive(live.pid), 1000);
			expect(existsSync(transcript)).toBe(false);
			await closing;
		} finally {
			delete process.env.FAKE_AGY_STUBBORN;
		}
	});

	test("a non-OMP tool attempt during a context part fails the request before any further part is sent", async () => {
		const mark = fakeLog().length;
		const out = await withEnv({ FAKE_AGY_SEED: "nativeok" }, () => run(runtime, [user(bulk)], { sessionId: "seed-native" }));
		expect(out.message.stopReason).toBe("error");
		expect(out.message.errorMessage).toContain("non-OMP tool (run_command)");
		expect(count("session/prompt", mark)).toBe(1);
	});

	test("a rate limit during a context part surfaces as a 429", async () => {
		const out = await withEnv({ FAKE_AGY_SEED: "ratelimit" }, () => run(runtime, [user(bulk)], { sessionId: "seed-ratelimit" }));
		expect(out.message.stopReason).toBe("error");
		expect(out.message.errorStatus).toBe(429);
	});

	test("a tool call during a context part is refused at once and delivery continues", async () => {
		const mark = fakeLog().length;
		const out = await withEnv({ FAKE_AGY_SEED: "call" }, () => run(runtime, [user(bulk)], { sessionId: "seed-call" }));
		expect(out.message.stopReason).toBe("stop");
		expect(out.calls).toEqual([]);
		expect(count("session/prompt", mark)).toBe(2);
	});

	test("an inline continuation aborted before agy shows progress is rebuilt with its tool results", async () => {
		const state = new Map<string, ProviderSessionState>();
		const controller = new AbortController();
		const mark = fakeLog().length;
		const history: Message[] = [user('#fake:call read {"path":"a.txt"}')];
		const first = await run(runtime, history, { sessionId: "inline-abort", state });
		history.push(first.message, result(first.calls[0], "INLINE-RESULT"));
		const pending = run(runtime, history, { sessionId: "inline-abort", state, signal: controller.signal });
		controller.abort();
		const aborted = await pending;
		expect(aborted.message.stopReason).toBe("aborted");
		history.push(aborted.message, user("what did it say?"));
		const next = await run(runtime, history, { sessionId: "inline-abort", state });
		expect(next.message.stopReason).toBe("stop");
		expect(count("session/new", mark)).toBe(2);
		expect(fakeLog().slice(mark).findLast(e => e.method === "session/prompt")?.text).toContain("INLINE-RESULT");
	});

	test("a request queued behind a provider state that then closes does not start a session for it", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const first = run(runtime, [user("#fake:wait")], { sessionId: "queued-close", state });
		await waitFor(() => count("session/prompt", mark) === 1);
		const second = run(runtime, [user("#fake:wait"), user("again")], { sessionId: "queued-close", state });
		state.get("antigravity-acp")?.close();
		const outcomes = await Promise.all([first, second]);
		expect(outcomes.map(o => o.message.stopReason)).toEqual(["error", "error"]);
		expect(count("session/new", mark)).toBe(1);
	});

	test("a session closed while the host's payload hook runs ends the request instead of hanging it", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		const out = await run(runtime, [user("hello")], { sessionId: "hook-close", state, onPayload: () => void state.get("antigravity-acp")?.close() });
		expect(out.message.stopReason).toBe("error");
		expect(count("session/prompt", mark)).toBe(0);
	});

	test("closing a session kills a worker that outlives agy's main process", async () => {
		const state = new Map<string, ProviderSessionState>();
		const mark = fakeLog().length;
		await withEnv({ FAKE_AGY_WORKER: "1" }, () => run(runtime, [user("hello")], { sessionId: "worker", state }));
		const worker = fakeLog().slice(mark).find(e => e.method === "worker")?.worker;
		expect(worker).toBeNumber();
		state.get("antigravity-acp")?.close();
		await waitFor(() => !alive(worker as number), 3000);
	});

	test("shutdown reaches an agy that has not finished initializing", async () => {
		const own = new Runtime();
		const mark = fakeLog().length;
		process.env.FAKE_AGY_INIT_DELAY_MS = "3000";
		process.env.FAKE_AGY_STUBBORN = "1";
		let pending: Promise<Outcome>;
		try {
			pending = run(own, [user("hello")], { sessionId: "slow-init" });
			await waitFor(() => fakeLog().slice(mark).some(e => e.method === "boot"));
		} finally {
			delete process.env.FAKE_AGY_INIT_DELAY_MS;
			delete process.env.FAKE_AGY_STUBBORN;
		}
		const boot = fakeLog().slice(mark).find(e => e.method === "boot");
		const closing = own.closeAll("OMP shut down");
		own.killAll();
		await waitFor(() => boot !== undefined && !alive(boot.pid), 1000);
		await closing;
		expect((await pending).message.stopReason).toBe("error");
	});
});
