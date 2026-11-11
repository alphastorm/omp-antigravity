// Live Antigravity sessions owned by OMP sessions, and the turn/tool-continuation state machine.
//
// One OMP routing session (SimpleStreamOptions.sessionId) owns one `agy acp` process, one ACP
// session, and one loopback MCP bridge. A tool call parks its MCP request and ends the OMP stream at
// toolUse; the next request resolves it in place when the result fits the runtime's MCP limits,
// otherwise it cancels the ACP turn and delivers the results as the next prompt. OMP's transcript
// stays the source of truth: anything that no longer matches is rebuilt from the supplied context.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ContentBlock, RequestPermissionRequest, RequestPermissionResponse, SessionNotification } from "@agentclientprotocol/sdk";
import type {
	AssistantMessageEventStream,
	Context,
	Message,
	Model,
	ProviderSessionState,
	SimpleStreamOptions,
	ToolResultMessage,
} from "@oh-my-pi/pi-ai";
import { AdapterError, AgentProcess, deadline, defaultAgentLeak, ensureProfile, type PromptResult, type PromptUsage, type Profile } from "./acp.ts";
import { type ParkedCall, projectTools, ToolBridge } from "./bridge.ts";
import {
	addUsage,
	composeInstructions,
	historyBlocks,
	inlineResult,
	inputSegments,
	messageKey,
	packPrompts,
	StreamWriter,
	type ToolResultDelivery,
	toolResultSegments,
} from "./convert.ts";

export const PROVIDER = "antigravity-acp";

const ms = (name: string, fallback: number) => {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
};
const BATCH_QUIET_MS = 150;
const BATCH_MAX_MS = 1000;
/** Defer a still-running OMP tool before agy's fixed 180 s MCP call timeout fails it. */
const DEFER_AFTER_MS = ms("OMP_ANTIGRAVITY_DEFER_MS", 150_000);
const IDLE_PROMPT_MS = ms("OMP_ANTIGRAVITY_IDLE_TIMEOUT_MS", 10 * 60_000);
const WARM_TTL_MS = ms("OMP_ANTIGRAVITY_WARM_TTL_MS", 20 * 60_000);
const PENDING_TTL_MS = ms("OMP_ANTIGRAVITY_PENDING_TIMEOUT_MS", 12 * 60 * 60_000);
const CANCEL_GRACE_MS = 5000;
const STARTUP_MS = 60_000;
/** How long agy may take to report its command list; 1.5.5 sends it about 12 ms after `session/new` answers. */
const COMMANDS_MS = 5000;

/** agy's own retry notices, emitted as agent text (e.g. "⚠ API error (attempt 2): RESOURCE_EXHAUSTED …"). */
const RETRY_NOTICE = /^\s*⚠\s*API error \(attempt \d+\)/;
const RATE_LIMIT_NOTICE = /RESOURCE_EXHAUSTED|\b429\b|rate.?limit|quota/i;
/** What the model is told about a call that reached the bridge after the host had collected that turn's calls. */
const NOT_RUN = "OMP did not run this tool call: it arrived after the host had collected this turn's calls. Call it again if you still need it.";
/** Updates that show agy has taken in what it was last given: model output and tool events. */
const PROGRESS: Record<string, true> = { agent_message_chunk: true, agent_thought_chunk: true, tool_call: true, tool_call_update: true };
const CLOSED_WHILE_STARTING = "the OMP session closed while Antigravity was starting";
const SCOPE_CLOSED = "OMP closed the provider session before this request started";

/** OMP_ANTIGRAVITY_DEBUG=<dir> writes session setup, prompt payloads, and ACP updates there (contains prompt text). */
function debugDump(name: string, value: unknown, append = false): void {
	const dir = process.env.OMP_ANTIGRAVITY_DEBUG;
	if (!dir) return;
	try {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (append) appendFileSync(join(dir, name), `${JSON.stringify(value)}\n`, { mode: 0o600 });
		else writeFileSync(join(dir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
	} catch {}
}

interface Desired {
	model: string;
	effort: string | undefined;
	instructions: string;
	profile: "bridge" | "tool-free";
	tools: ReturnType<typeof projectTools>;
	fingerprint: string;
}

function desiredFor(model: Model, context: Context, options: SimpleStreamOptions): Desired {
	const tools = projectTools(context.tools ?? []);
	const profile = tools.length > 0 ? "bridge" : "tool-free";
	const instructions = composeInstructions(context.systemPrompt, profile);
	// Antigravity cannot switch reasoning off; a disable request keeps the model's default level.
	const effort = options.disableReasoning || options.forceReasoningOff ? undefined : options.reasoning;
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ model: model.id, effort, instructions, tools: tools.map(t => [t.mcpName, t.description, t.inputSchema]) }))
		.digest("hex");
	return { model: model.id, effort, instructions, profile, tools, fingerprint };
}

/** Per-key FIFO so one OMP routing session never has two requests in flight. */
class KeyQueue {
	readonly #tails = new Map<string, Promise<void>>();

	async acquire(key: string, signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) throw new AdapterError("aborted", "Request aborted while queued");
		const previous = this.#tails.get(key) ?? Promise.resolve();
		const { promise: released, resolve: release } = Promise.withResolvers<void>();
		const tail = previous.then(() => released);
		this.#tails.set(key, tail);
		void tail.then(() => {
			if (this.#tails.get(key) === tail) this.#tails.delete(key);
		});
		const aborted = signal
			? new Promise<never>((_, reject) =>
					signal.addEventListener("abort", () => reject(new AdapterError("aborted", "Request aborted while queued")), { once: true }),
				)
			: undefined;
		try {
			await (aborted ? Promise.race([previous, aborted]) : previous);
		} catch (error) {
			release();
			throw error;
		}
		let done = false;
		return () => {
			if (done) return;
			done = true;
			release();
		};
	}
}

/** OMP's per-AgentSession provider state; OMP closes it on dispose, /new, reset, and switch. */
class Scope implements ProviderSessionState {
	readonly keys = new Set<string>();
	readonly #runtime: Runtime;
	closed = false;

	constructor(runtime: Runtime) {
		this.#runtime = runtime;
	}

	close(): void {
		this.closed = true;
		for (const key of this.keys) void this.#runtime.closeKey(key, "OMP closed the provider session");
		this.keys.clear();
	}

	releaseSession(sessionId: string): void {
		if (this.keys.delete(sessionId)) void this.#runtime.closeKey(sessionId, "OMP released the routing session");
	}
}

type Outcome = "stop" | "length" | "toolUse" | "aborted" | "error";

class LiveSession {
	readonly key: string;
	readonly scope: Scope;
	readonly runtime: Runtime;
	desired: Desired;
	agent!: AgentProcess;
	bridge: ToolBridge | undefined;
	acpSessionId = "";
	selection = { model: "", effort: undefined as string | undefined };
	/** Keys of OMP messages Antigravity has already seen, in transcript order. */
	delivered: string[] = [];
	/** Calls emitted to OMP in the last toolUse segment, awaiting their results. */
	pending: ParkedCall[] = [];
	/** Calls that arrived while no OMP stream was attached. */
	late: ParkedCall[] = [];
	/** The ACP turn was cancelled; pending results go out as the next prompt. */
	deferred = false;
	prompt: { done: Promise<PromptResult>; cancelled: boolean } | undefined;
	writer: StreamWriter | undefined;
	#releaseWriter: (() => void) | undefined;
	#abortWriter: (() => void) | undefined;
	carryUsage: PromptUsage | undefined;
	broken: string | undefined;
	closed = false;
	#batchTimer: Timer | undefined;
	#batchStarted = 0;
	#deferTimer: Timer | undefined;
	#idleTimer: Timer | undefined;
	#ttlTimer: Timer | undefined;
	commands: string[] = [];
	/** Settles when agy first reports its command list; fails if the session closes first. */
	readonly #commandsSeen = Promise.withResolvers<void>();
	#acceptEmpty = false;
	lastNotice: string | undefined;
	rateLimited: string | undefined;
	/** The last turn was cut off by a rate-limit notice; OMP's identical retry re-asks in place. */
	retryAfterLimit = false;
	/** Aborted by close() and killNow(), so both reach a process that is still starting. */
	readonly #startup = new AbortController();
	/** An acknowledgement-only context part is in flight: no OMP stream exists to take tool calls. */
	#seeding = false;
	/** Tool results were resolved in place and agy has shown no progress since. */
	#inlineUnconfirmed = false;

	constructor(key: string, scope: Scope, runtime: Runtime, desired: Desired) {
		this.key = key;
		this.scope = scope;
		this.runtime = runtime;
		this.desired = desired;
		// start() awaits this; a close after startup rejects it with nobody listening.
		this.#commandsSeen.promise.catch(() => {});
	}

	get state(): string {
		if (this.closed) return "closed";
		if (this.writer) return "streaming";
		if (this.pending.length) return this.deferred ? "awaiting-results" : "parked";
		return this.prompt ? "prompting" : "idle";
	}

	async start(profile: Profile, signal?: AbortSignal): Promise<void> {
		if (this.desired.profile === "bridge") {
			this.bridge = new ToolBridge(call => this.#onCall(call));
			this.bridge.setTools(this.desired.tools);
		}
		const mcpServer = this.bridge?.start();
		this.agent = await AgentProcess.start({
			profile,
			signal: signal ? AbortSignal.any([signal, this.#startup.signal]) : this.#startup.signal,
			timeoutMs: STARTUP_MS,
			hooks: {
				onUpdate: n => this.#onUpdate(n),
				onPermission: r => this.#onPermission(r),
				onExit: reason => this.#lose(reason),
			},
		}).catch(error => {
			// close() aborts a start in progress; that is the session ending, not the request's own abort.
			throw this.closed ? new AdapterError("process_exit", CLOSED_WHILE_STARTING) : error;
		});
		if (this.closed) {
			// close() ran just as agy came up and had no process to stop. Nothing tracks this process any
			// more, so it is killed here and now rather than closed gracefully.
			this.agent.killNow();
			throw new AdapterError("process_exit", CLOSED_WHILE_STARTING);
		}
		debugDump(`session-${Date.now()}.json`, { key: this.key, desired: this.desired });
		// An abort during the rest of startup kills agy, which fails its pending request at once. agy 1.5.5
		// creates the conversation only as session/new answers, so a kill before that leaves no files.
		const onAbort = () => this.agent.killNow();
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			if (signal?.aborted) onAbort();
			const opened = await this.agent.openSession({
				workspace: profile.workspace,
				append: this.desired.instructions,
				mcpServer,
				model: this.desired.model,
				effort: this.desired.effort,
			});
			this.acpSessionId = opened.sessionId;
			this.selection = { model: opened.model, effort: opened.effort };
			// The restricted profile must be confirmed before any prompt. agy reports its command list right
			// after session/new: a default-agent command means it fell back to its default agent (native
			// tools, rules, skills), and no list at all leaves the profile unconfirmed. Either way this
			// session is unusable.
			await deadline(this.#commandsSeen.promise, COMMANDS_MS, "Antigravity's command list (needed to confirm the restricted omp-host profile)");
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
		const leak = defaultAgentLeak(this.commands);
		if (leak) throw new AdapterError("profile", `Antigravity did not apply the restricted omp-host profile (offered /${leak})`);
	}

	/** Appends one ACP update or tool event to this session's OMP_ANTIGRAVITY_DEBUG trace. */
	#trace(entry: Record<string, unknown>): void {
		debugDump(`updates-${this.key.replace(/[^\w.-]/g, "_")}.jsonl`, { at: Date.now(), ...entry }, true);
	}

	// ---- inbound from agy -------------------------------------------------------------------

	#onUpdate(notification: SessionNotification): void {
		if (notification.sessionId !== this.acpSessionId && this.acpSessionId) return;
		const update = notification.update;
		this.#trace({ update });
		this.#touch();
		if (PROGRESS[update.sessionUpdate]) this.#inlineUnconfirmed = false;
		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				if (update.content.type === "text") {
					// agy reports its own transport retries as message text; they are not model output.
					if (RETRY_NOTICE.test(update.content.text)) {
						this.lastNotice = update.content.text.trim();
						// Do not let agy's backoff chain run: one quota/rate-limit notice ends the turn so only
						// OMP's retry policy applies (README "Rate limits").
						if (RATE_LIMIT_NOTICE.test(this.lastNotice)) this.#rateLimited(this.lastNotice);
						return;
					}
					this.writer?.text(update.content.text);
				} else if (update.content.type === "image") {
					this.writer?.image({ type: "image", data: update.content.data, mimeType: update.content.mimeType });
				}
				return;
			case "agent_thought_chunk":
				if (update.content.type === "text") this.writer?.thinking(update.content.text);
				return;
			case "tool_call":
			case "tool_call_update": {
				const name = "name" in update && typeof update.name === "string" ? update.name : (update.title ?? "");
				const bridged = this.bridge?.ompName(name) ?? this.bridge?.ompName(name.replace(/^Run /, ""));
				if (!bridged) this.#violation(`Antigravity attempted a non-OMP tool (${name || update.toolCallId})`);
				return;
			}
			case "available_commands_update": {
				this.commands = update.availableCommands.map(c => c.name);
				this.#commandsSeen.resolve();
				const leak = defaultAgentLeak(this.commands);
				if (leak && this.acpSessionId) this.#violation(`Antigravity fell back to its default agent (offered /${leak})`);
				return;
			}
			default:
				return;
		}
	}

	#onPermission(request: RequestPermissionRequest): RequestPermissionResponse {
		const name = "name" in request.toolCall && typeof request.toolCall.name === "string" ? request.toolCall.name : (request.toolCall.title ?? "");
		if (this.bridge?.ompName(name)) {
			// OMP still validates and policy-checks the call when it executes it.
			const allow = request.options.find(o => o.kind === "allow_once");
			if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } };
		}
		this.#violation(`Antigravity requested permission for a non-OMP operation (${name || request.toolCall.toolCallId})`);
		const reject = request.options.find(o => o.kind === "reject_once");
		return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
	}

	#onCall(call: ParkedCall): void {
		this.#touch();
		this.#trace({ parkedCall: { id: call.id, name: call.name, arguments: call.arguments } });
		this.#inlineUnconfirmed = false;
		if (this.closed || !this.prompt || this.prompt.cancelled || this.#seeding) {
			call.settle({ content: [{ type: "text", text: "No OMP turn is waiting for tool calls; end your turn." }], isError: true });
			return;
		}
		if (this.writer && !this.writer.ended) {
			this.writer.toolCall(call);
			this.pending.push(call);
			this.#scheduleBatch();
		} else {
			this.late.push(call);
		}
		this.#armDefer();
	}

	#scheduleBatch(): void {
		const now = Date.now();
		if (!this.#batchTimer) this.#batchStarted = now;
		clearTimeout(this.#batchTimer);
		const wait = Math.max(0, Math.min(BATCH_QUIET_MS, this.#batchStarted + BATCH_MAX_MS - now));
		this.#batchTimer = setTimeout(() => {
			this.#batchTimer = undefined;
			const writer = this.writer;
			if (!writer || writer.ended) return;
			writer.finish("toolUse");
			this.delivered.push(messageKey(writer.message));
			this.#detachWriter();
		}, wait);
	}

	#armDefer(): void {
		if (this.#deferTimer || this.deferred) return;
		const first = [...this.pending, ...this.late].reduce((t, c) => Math.min(t, c.arrivedAt), Date.now());
		this.#deferTimer = setTimeout(() => {
			this.#deferTimer = undefined;
			if (this.pending.some(c => !c.settled) || this.late.some(c => !c.settled)) {
				void this.#defer("OMP is still executing this tool call; its result will follow in the next host message.");
			}
		}, Math.max(0, first + DEFER_AFTER_MS - Date.now()));
	}

	/** Ends the live ACP turn while OMP keeps working; parked results then travel as a prompt. */
	async #defer(text: string): Promise<void> {
		if (this.deferred) return;
		this.deferred = true;
		clearTimeout(this.#deferTimer);
		this.#deferTimer = undefined;
		await this.#cancelPrompt(text);
	}

	async #cancelPrompt(text: string): Promise<void> {
		const prompt = this.prompt;
		// Captured now: a continuation may replace both lists while the cancel is still on its way.
		const { pending, late } = this;
		if (prompt && !prompt.cancelled) {
			prompt.cancelled = true;
			await this.agent.cancel(this.acpSessionId).catch(() => {});
		}
		for (const call of pending) call.settle({ content: [{ type: "text", text }], isError: true });
		// Late calls were never offered to OMP: say so rather than promise a result. They stay listed so a
		// deferred continuation can repeat that in its prompt.
		for (const call of late) call.settle({ content: [{ type: "text", text: NOT_RUN }], isError: true });
		if (prompt) {
			const ended = await Promise.race([prompt.done.then(() => true, () => true), Bun.sleep(CANCEL_GRACE_MS).then(() => false)]);
			if (!ended) this.#lose("Antigravity did not acknowledge cancellation");
		}
	}

	#violation(reason: string): void {
		if (this.broken) return;
		this.broken = reason;
		const writer = this.writer;
		if (writer && !writer.ended) {
			writer.fail("error", `antigravity-acp: ${reason}. The turn was stopped; the next request rebuilds the session.`);
			this.#detachWriter();
		}
		void this.#cancelPrompt(`Stopped by omp-antigravity: ${reason}.`);
		this.runtime.retire(this);
	}

	/**
	 * First quota/rate-limit notice: cancel instead of letting agy retry, so only OMP's retry policy
	 * decides. The conversation stays usable: OMP's retry of the same context re-asks in place.
	 */
	#rateLimited(notice: string): void {
		if (this.rateLimited) return;
		this.rateLimited = notice;
		// Keep this key's queue until agy confirms the cancel, so OMP's retry finds an idle session.
		const release = this.#releaseWriter;
		this.#releaseWriter = undefined;
		// Put the cancel on the wire before OMP sees the error and can decide to retry.
		const cancelling = this.#cancelPrompt("Cancelled by omp-antigravity after an Antigravity rate-limit notice.");
		const writer = this.writer;
		if (writer && !writer.ended) {
			writer.fail("error", `antigravity-acp: Antigravity rate limit (429 RESOURCE_EXHAUSTED); turn cancelled without retries. ${notice}`, undefined, 429);
			this.#detachWriter();
		}
		void cancelling.finally(() => {
			this.pending = [];
			this.late = [];
			this.deferred = false;
			this.rateLimited = undefined;
			this.retryAfterLimit = true;
			release?.();
		});
	}

	/** Involuntary loss (process exit, protocol failure, stall): surface it and tear down. */
	#lose(reason: string): void {
		this.broken ??= reason;
		// Also when already closed: a stream attached to a session that closed underneath it must still end.
		const writer = this.writer;
		if (writer && !writer.ended) {
			writer.fail("error", `antigravity-acp: ${reason}`);
			this.#detachWriter();
		}
		if (!this.closed) void this.runtime.closeLive(this, reason);
	}

	#touch(): void {
		if (this.closed) return;
		clearTimeout(this.#idleTimer);
		if (this.writer && this.prompt) {
			this.#idleTimer = setTimeout(() => this.#lose(`no Antigravity progress for ${Math.round(IDLE_PROMPT_MS / 1000)}s`), IDLE_PROMPT_MS);
		}
		clearTimeout(this.#ttlTimer);
		const ttl = this.pending.length || this.late.length ? PENDING_TTL_MS : WARM_TTL_MS;
		this.#ttlTimer = setTimeout(() => {
			if (!this.writer) void this.runtime.closeLive(this, "idle Antigravity session expired");
		}, ttl);
	}

	// ---- OMP stream attachment ---------------------------------------------------------------

	#attachWriter(writer: StreamWriter, release: () => void, signal?: AbortSignal): void {
		this.writer = writer;
		this.#releaseWriter = release;
		if (signal) {
			const onAbort = () => void this.#abort();
			signal.addEventListener("abort", onAbort, { once: true });
			this.#abortWriter = () => signal.removeEventListener("abort", onAbort);
			if (signal.aborted) onAbort();
		}
		this.#touch();
	}

	#detachWriter(): void {
		this.writer = undefined;
		clearTimeout(this.#idleTimer);
		clearTimeout(this.#batchTimer);
		this.#batchTimer = undefined;
		this.#abortWriter?.();
		this.#abortWriter = undefined;
		const release = this.#releaseWriter;
		this.#releaseWriter = undefined;
		release?.();
		this.#touch();
	}

	async #abort(): Promise<void> {
		const writer = this.writer;
		if (!writer || writer.ended) return;
		writer.fail("aborted", "Request aborted");
		this.delivered.push(messageKey(writer.message));
		if (this.#inlineUnconfirmed) {
			// The cancel can overtake results resolved in place a moment ago, and agy may never record them.
			this.broken ??= "aborted before Antigravity took in tool results resolved in place";
			this.#detachWriter();
			this.runtime.retire(this);
			return;
		}
		// Keep this key's queue until agy confirms the cancel, so the next request finds the session idle
		// instead of rebuilding around a turn that is still winding down.
		const release = this.#releaseWriter;
		this.#releaseWriter = undefined;
		this.#detachWriter();
		try {
			await this.#cancelPrompt("The OMP request was aborted.");
		} finally {
			this.pending = [];
			this.late = [];
			this.deferred = false;
			release?.();
		}
	}

	/**
	 * Sends prompt parts. Callers record the request's messages as delivered first, so a failure before
	 * the final part is attached leaves agy holding none or only some of them: the session is then
	 * marked for a rebuild from OMP's transcript, and a turn still in flight is cancelled.
	 */
	async #send(parts: ContentBlock[][], writer: StreamWriter, release: () => void, options: SimpleStreamOptions, model: Model): Promise<void> {
		try {
			await this.#sendParts(parts, writer, release, options, model);
		} catch (error) {
			// Already broken means a violation or a loss ended this request; that reason is the one to report.
			const cause = this.broken;
			this.broken ??= `a request ended before its prompt was fully sent (${error instanceof Error ? error.message : String(error)})`;
			if (this.prompt && !this.prompt.cancelled) void this.#cancelPrompt("The OMP request ended.");
			throw cause && !(error instanceof AdapterError) ? new AdapterError("profile", cause) : error;
		}
	}

	/** Earlier parts are acknowledgement-only seeds whose output is discarded; the last one streams to OMP. */
	async #sendParts(parts: ContentBlock[][], writer: StreamWriter, release: () => void, options: SimpleStreamOptions, model: Model): Promise<void> {
		if (this.broken) throw new AdapterError("profile", this.broken);
		const previous = this.prompt;
		if (previous) {
			await Promise.race([previous.done.catch(() => {}), Bun.sleep(CANCEL_GRACE_MS)]);
			if (this.prompt === previous) throw new AdapterError("protocol", "the previous Antigravity turn did not end");
		}
		this.#acceptEmpty = options.acceptEmptyResponse === true;
		for (let i = 0; i < parts.length; i++) {
			const blocks = parts[i];
			const last = i === parts.length - 1;
			const payload = {
				transport: PROVIDER,
				agent: this.agent.agentLabel,
				agentPath: this.agent.path,
				acpSessionId: this.acpSessionId,
				model: this.selection.model,
				effort: this.selection.effort,
				profile: this.desired.profile,
				part: `${i + 1}/${parts.length}`,
				prompt: blocks,
			};
			debugDump(`prompt-${Date.now()}-${i + 1}.json`, payload);
			const replaced = await options.onPayload?.(payload, model, options.signal);
			if (replaced !== undefined && replaced !== payload) {
				throw new AdapterError("protocol", "antigravity-acp cannot apply a replaced provider payload");
			}
			if (options.signal?.aborted) throw new AdapterError("aborted", "Request aborted");
			// The awaits above can outlast the session: a violation, a loss, or a close ends the request here.
			if (this.broken) throw new AdapterError("profile", this.broken);
			if (this.closed) throw new AdapterError("process_exit", "the Antigravity session closed before its prompt was sent");
			this.lastNotice = undefined;
			const done = this.agent.prompt(this.acpSessionId, blocks);
			const prompt = { done, cancelled: false };
			this.prompt = prompt;
			if (!last) {
				// No OMP stream is attached yet: an abort and a stalled agy are handled here, and tool calls are refused.
				const onAbort = () => void this.#cancelPrompt("The OMP request was aborted.");
				options.signal?.addEventListener("abort", onAbort, { once: true });
				this.#seeding = true;
				const result = await deadline(done, IDLE_PROMPT_MS, "Antigravity context delivery").finally(() => {
					this.#seeding = false;
					options.signal?.removeEventListener("abort", onAbort);
				});
				this.prompt = undefined;
				this.carryUsage = addUsage(this.carryUsage, result.usage);
				if (options.signal?.aborted) throw new AdapterError("aborted", "Request aborted");
				// A violation or a loss during this part is the reason to report, whatever the part's stop reason.
				if (this.broken) throw new AdapterError("profile", this.broken);
				// Read from the notice itself: #rateLimited clears its own state once the cancel settles.
				if (this.lastNotice && RATE_LIMIT_NOTICE.test(this.lastNotice)) {
					// agy saw only part of the replay; a retry must rebuild rather than re-ask.
					this.broken ??= "rate limited while delivering earlier context parts";
					throw new AdapterError("rate_limited", `Antigravity rate limit (429 RESOURCE_EXHAUSTED): ${this.lastNotice}`);
				}
				if (result.stopReason !== "end_turn") throw new AdapterError("protocol", `Antigravity stopped a context delivery part with ${result.stopReason}`);
				continue;
			}
			// Attached only now that `prompt` is set, so the idle watchdog also covers a turn agy never starts.
			this.#attachWriter(writer, release, options.signal);
			void done.then(
				result => this.#promptEnded(prompt, result),
				error => this.#lose(`session/prompt failed: ${error instanceof Error ? error.message : String(error)}`),
			);
		}
	}

	#promptEnded(prompt: NonNullable<LiveSession["prompt"]>, result: PromptResult): void {
		if (this.prompt === prompt) this.prompt = undefined;
		this.#inlineUnconfirmed = false;
		clearTimeout(this.#batchTimer);
		this.#batchTimer = undefined;
		const usage = addUsage(this.carryUsage, result.usage);
		const writer = this.writer;
		if (!writer || writer.ended) {
			this.carryUsage = usage;
			if (!prompt.cancelled && (this.pending.some(c => !c.settled) || this.late.some(c => !c.settled))) {
				this.broken ??= "Antigravity ended its turn while OMP tool calls were pending";
				this.runtime.retire(this);
			}
			return;
		}
		this.carryUsage = undefined;
		let outcome: Outcome;
		switch (result.stopReason) {
			case "end_turn":
				if (writer.hasOutput || writer.toolCallCount > 0 || this.#acceptEmpty) {
					writer.finish(writer.toolCallCount > 0 ? "toolUse" : "stop", usage);
					outcome = writer.toolCallCount > 0 ? "toolUse" : "stop";
				} else {
					const notice = this.lastNotice ? ` (last runtime notice: ${this.lastNotice})` : "";
					writer.fail("error", `antigravity-acp: Antigravity ended the turn without any output${notice}`, usage);
					outcome = "error";
				}
				break;
			case "max_tokens":
				writer.finish("length", usage);
				outcome = "length";
				break;
			case "cancelled":
				writer.fail("error", "antigravity-acp: Antigravity cancelled the turn", usage);
				outcome = "error";
				break;
			case "refusal":
				writer.fail("error", "antigravity-acp: Antigravity refused the request", usage);
				outcome = "error";
				break;
			default:
				writer.fail("error", `antigravity-acp: Antigravity stopped with ${result.stopReason}; output is incomplete`, usage);
				outcome = "error";
		}
		if (outcome === "error") this.broken ??= `previous turn failed (${result.stopReason})`;
		else this.delivered.push(messageKey(writer.message));
		this.#detachWriter();
		if (this.broken) this.runtime.retire(this);
	}

	// ---- request entry points ----------------------------------------------------------------

	async cold(context: Context, writer: StreamWriter, release: () => void, options: SimpleStreamOptions, model: Model): Promise<void> {
		const messages = context.messages;
		let start = messages.length;
		while (start > 0 && (messages[start - 1].role === "user" || messages[start - 1].role === "developer")) start--;
		// A transcript ending in tool results resumes that round: replay through the assistant turn.
		let results: ToolResultMessage[] = [];
		if (start === messages.length) {
			let end = messages.length;
			while (end > 0 && messages[end - 1].role === "toolResult") end--;
			results = messages.slice(end) as ToolResultMessage[];
			start = end;
		}
		const deliveries: ToolResultDelivery[] = results.map(result => ({
			call: findCall(messages, result.toolCallId) ?? { id: result.toolCallId, name: result.toolName, arguments: {} },
			result,
		}));
		const segments = [
			...historyBlocks(messages.slice(0, start)),
			...toolResultSegments(deliveries),
			...inputSegments(messages.slice(start).filter(m => m.role !== "toolResult")),
			...choiceNote(options),
		];
		this.delivered = messages.map(messageKey);
		await this.#send(packPrompts(segments.length ? segments : ["[OMP user message]\n(empty)\n"]), writer, release, options, model);
	}

	async warm(delta: readonly Message[], writer: StreamWriter, release: () => void, options: SimpleStreamOptions, model: Model): Promise<void> {
		this.retryAfterLimit = false;
		this.delivered.push(...delta.map(messageKey));
		const parts = packPrompts([...inputSegments(delta), ...choiceNote(options)]);
		await this.#send(parts, writer, release, options, model);
	}

	/** OMP retried a turn that a rate-limit notice cut off: agy already holds the request, so re-ask. */
	async retryTurn(writer: StreamWriter, release: () => void, options: SimpleStreamOptions, model: Model): Promise<void> {
		this.retryAfterLimit = false;
		const note = "[OMP retry]\nYour previous turn was cut off by a rate-limit error before you finished. Respond to the latest OMP message now.\n";
		await this.#send(packPrompts([note, ...choiceNote(options)]), writer, release, options, model);
	}

	/** Matches the request against parked calls; returns the reason it cannot continue, if any. */
	matchContinuation(messages: readonly Message[]): { results: Map<string, ToolResultMessage>; tail: Message[] } | string {
		const keys = messages.map(messageKey);
		if (!isPrefix(this.delivered, keys)) return "history changed while tool calls were pending";
		const results = new Map<string, ToolResultMessage>();
		const tail: Message[] = [];
		for (const message of messages.slice(this.delivered.length)) {
			if (message.role === "toolResult") results.set(message.toolCallId, message);
			else if (message.role === "user" || message.role === "developer") tail.push(message);
			else return `unexpected ${message.role} message after pending tool calls`;
		}
		const missing = this.pending.filter(c => !results.has(c.id));
		if (missing.length) return `missing results for ${missing.map(c => c.name).join(", ")}`;
		return { results, tail };
	}

	async continueTurn(
		match: { results: Map<string, ToolResultMessage>; tail: Message[] },
		messages: readonly Message[],
		writer: StreamWriter,
		release: () => void,
		options: SimpleStreamOptions,
		model: Model,
	): Promise<void> {
		clearTimeout(this.#deferTimer);
		this.#deferTimer = undefined;
		const pending = this.pending;
		this.delivered = messages.map(messageKey);
		const inline = pending.map(call => inlineResult(match.results.get(call.id)!));
		const canInline =
			!this.deferred && this.prompt !== undefined && !this.prompt.cancelled && match.tail.length === 0 && pending.every(c => !c.settled) && inline.every(Boolean);
		if (canInline) {
			this.pending = [];
			// Set before attaching: an abort that is already signalled runs from inside #attachWriter.
			this.#inlineUnconfirmed = true;
			this.#attachWriter(writer, release, options.signal);
			if (writer.ended) return;
			pending.forEach((call, i) => {
				this.#trace({ inlineResult: { id: call.id, name: call.name, result: inline[i] } });
				call.settle(inline[i]!);
			});
			// A late call agy has already withdrawn is not offered to OMP.
			const late = this.late.filter(call => !call.settled);
			this.late = [];
			for (const call of late) {
				writer.toolCall(call);
				this.pending.push(call);
			}
			if (late.length) {
				this.#scheduleBatch();
				this.#armDefer();
			}
			return;
		}
		if (this.prompt && !this.prompt.cancelled) {
			this.deferred = true;
			await this.#cancelPrompt("The host delivers this result in its next message.");
		}
		const notRun = this.late;
		this.pending = [];
		this.late = [];
		this.deferred = false;
		const deliveries = pending.map(call => ({ call, result: match.results.get(call.id)! }));
		const parts = packPrompts([...toolResultSegments(deliveries, notRun), ...inputSegments(match.tail), ...choiceNote(options)]);
		await this.#send(parts, writer, release, options, model);
	}

	async close(reason: string): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.#startup.abort();
		this.#commandsSeen.reject(new AdapterError("process_exit", `the Antigravity session closed during startup (${reason})`));
		for (const timer of [this.#batchTimer, this.#deferTimer, this.#idleTimer, this.#ttlTimer]) clearTimeout(timer);
		const writer = this.writer;
		if (writer && !writer.ended) {
			writer.fail("error", `antigravity-acp: ${reason}`);
			this.#detachWriter();
		}
		this.bridge?.close(`The OMP session ended (${reason}).`);
		if (this.prompt && !this.prompt.cancelled && this.acpSessionId) {
			this.prompt.cancelled = true;
			await this.agent?.cancel(this.acpSessionId).catch(() => {});
		}
		await this.agent?.close();
	}

	killNow(): void {
		this.#startup.abort();
		this.agent?.killNow();
	}
}

function findCall(messages: readonly Message[], id: string): { id: string; name: string; arguments: Record<string, unknown> } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		for (const block of message.content) if (block.type === "toolCall" && block.id === id) return block;
	}
	return undefined;
}

function isPrefix(prefix: readonly string[], keys: readonly string[]): boolean {
	return prefix.length <= keys.length && prefix.every((key, i) => keys[i] === key);
}

/** Antigravity cannot enforce OMP tool choice; carry it as an explicit host note instead. */
function choiceNote(options: SimpleStreamOptions): string[] {
	const choice = options.toolChoice;
	if (choice === "none") return ["[OMP host note: answer without calling tools for this turn.]\n"];
	if (choice && typeof choice === "object" && "name" in choice && typeof choice.name === "string") {
		return [`[OMP host note: call the ${choice.name} tool now.]\n`];
	}
	if (choice && typeof choice === "object" && "function" in choice && choice.function && typeof choice.function === "object" && "name" in choice.function) {
		return [`[OMP host note: call the ${String(choice.function.name)} tool now.]\n`];
	}
	return [];
}

export class Runtime {
	readonly sessions = new Map<string, LiveSession>();
	readonly #queue = new KeyQueue();
	readonly #scopes = new WeakMap<Map<string, ProviderSessionState>, Scope>();
	readonly #fallback = new Scope(this);
	/** Sessions whose close() has not finished: no longer registered, possibly still running. */
	readonly #closing = new Set<LiveSession>();
	#rebuilds: { at: number; key: string; reason: string }[] = [];

	#scopeFor(state: Map<string, ProviderSessionState> | undefined): Scope {
		if (!state) return this.#fallback;
		let scope = this.#scopes.get(state);
		const existing = state.get(PROVIDER);
		if (existing && existing instanceof Scope && !existing.closed) scope = existing;
		else if (existing && !(existing instanceof Scope)) {
			throw new AdapterError("profile", "another antigravity-acp provider instance owns this OMP session (duplicate install?)");
		}
		if (!scope || scope.closed) {
			scope = new Scope(this);
			state.set(PROVIDER, scope);
		}
		this.#scopes.set(state, scope);
		return scope;
	}

	recentRebuilds(): readonly { at: number; key: string; reason: string }[] {
		return this.#rebuilds;
	}

	#rebuild(key: string, reason: string): void {
		this.#rebuilds = [...this.#rebuilds.slice(-19), { at: Date.now(), key, reason }];
	}

	async closeKey(key: string, reason: string): Promise<void> {
		const live = this.sessions.get(key);
		if (live) await this.closeLive(live, reason);
	}

	/** A broken session can serve nothing further: release its process now and keep the reason for the doctor. */
	retire(live: LiveSession): void {
		if (live.closed) return;
		this.#rebuild(live.key, live.broken ?? "session failed");
		void this.closeLive(live, `rebuilding: ${live.broken}`);
	}

	/** Closes `live` and forgets it only if it is still the session registered for its key. */
	async closeLive(live: LiveSession, reason: string): Promise<void> {
		if (this.sessions.get(live.key) === live) {
			this.sessions.delete(live.key);
			live.scope.keys.delete(live.key);
		}
		if (this.#closing.has(live)) return;
		this.#closing.add(live);
		try {
			await live.close(reason);
		} finally {
			this.#closing.delete(live);
		}
	}

	async closeAll(reason: string): Promise<void> {
		await Promise.all([...this.sessions.keys()].map(key => this.closeKey(key, reason)));
	}

	/** Synchronous last resort; also reaches sessions whose close() is still waiting for agy to exit. */
	killAll(): void {
		for (const live of [...this.sessions.values(), ...this.#closing]) live.killNow();
	}

	/** streamSimple body: never throws; failures end the stream with an error event. */
	async stream(model: Model, context: Context, options: SimpleStreamOptions, stream: AssistantMessageEventStream): Promise<void> {
		const writer = new StreamWriter(stream, model);
		let release: (() => void) | undefined;
		const key = options.sessionId ?? `ephemeral:${crypto.randomUUID()}`;
		try {
			const scope = this.#scopeFor(options.providerSessionState);
			release = await this.#queue.acquire(key, options.signal);
			// OMP may have closed the provider session while this request waited its turn.
			if (scope.closed) throw new AdapterError("process_exit", SCOPE_CLOSED);
			const desired = desiredFor(model, context, options);
			let live = this.sessions.get(key);
			if (live && (live.closed || live.scope !== scope)) {
				await this.closeKey(key, "provider state replaced");
				live = undefined;
			}
			if (live && live.pending.length) {
				const match = live.matchContinuation(context.messages);
				const reason = typeof match === "string" ? match : live.desired.fingerprint !== desired.fingerprint ? "instructions, tools, or model changed" : live.broken;
				if (!reason && typeof match !== "string") {
					await live.continueTurn(match, context.messages, writer, release, options, model);
					return;
				}
				this.#rebuild(key, reason ?? "continuation mismatch");
				await this.closeKey(key, `rebuilding: ${reason}`);
				live = undefined;
			}
			if (live) {
				const keys = context.messages.map(messageKey);
				const sameHistory = isPrefix(live.delivered, keys);
				if (!live.broken && live.desired.fingerprint === desired.fingerprint && sameHistory && keys.length === live.delivered.length) {
					if (live.retryAfterLimit && !live.prompt) {
						await live.retryTurn(writer, release, options, model);
						return;
					}
					// Nothing new (e.g. a cache-warming replay): never turn that into a real generation.
					throw new AdapterError("duplicate_request", "request contains no messages Antigravity has not already answered");
				}
				const reason = live.broken
					? live.broken
					: live.desired.fingerprint !== desired.fingerprint
						? "instructions, tools, or model changed"
						: !sameHistory
							? "history changed (branch, rewind, or compaction)"
							: live.prompt
								? "previous Antigravity turn still running"
								: undefined;
				if (!reason) {
					await live.warm(context.messages.slice(live.delivered.length), writer, release, options, model);
					return;
				}
				this.#rebuild(key, reason);
				await this.closeKey(key, `rebuilding: ${reason}`);
				live = undefined;
			}
			// The point of effect for every path above: tearing down an old session takes seconds, and the
			// request can be aborted or its provider session closed meanwhile. Nothing is started for either.
			if (options.signal?.aborted) throw new AdapterError("aborted", "Request aborted");
			if (scope.closed) throw new AdapterError("process_exit", SCOPE_CLOSED);
			live = new LiveSession(key, scope, this, desired);
			this.sessions.set(key, live);
			scope.keys.add(key);
			try {
				// Re-asserted for every session: the agent file is what keeps agy off its default agent.
				await live.start(ensureProfile(), options.signal);
			} catch (error) {
				await this.closeKey(key, "startup failed");
				throw error;
			}
			await live.cold(context, writer, release, options, model);
			if (key.startsWith("ephemeral:")) void this.#closeWhenDone(live);
		} catch (error) {
			const aborted = options.signal?.aborted || (error instanceof AdapterError && error.code === "aborted");
			const message = error instanceof Error ? error.message : String(error);
			const rateLimited = error instanceof AdapterError && error.code === "rate_limited";
			writer.fail(aborted ? "aborted" : "error", aborted ? "Request aborted" : `antigravity-acp: ${message}`, undefined, rateLimited ? 429 : undefined);
			release?.();
			const live = this.sessions.get(key);
			const duplicate = error instanceof AdapterError && error.code === "duplicate_request";
			if (live && live.writer === undefined && !aborted && !duplicate) live.broken ??= message;
			if (live?.broken && live.writer === undefined) this.retire(live);
			// Nothing can address an `ephemeral:` key again; do not hold its process until the idle TTL.
			if (key.startsWith("ephemeral:")) void this.closeKey(key, "ephemeral request failed");
		}
	}

	/** Nothing can address an `ephemeral:` key again, so its session ends with its only stream, parked calls included. */
	async #closeWhenDone(live: LiveSession): Promise<void> {
		while (!live.closed && live.writer) await Bun.sleep(250);
		await this.closeKey(live.key, "ephemeral request finished");
	}

	snapshot() {
		return [...this.sessions.values()].map(s => ({
			key: s.key,
			state: s.state,
			pid: s.agent?.pid,
			acpSessionId: s.acpSessionId,
			model: s.selection.model,
			effort: s.selection.effort,
			profile: s.desired.profile,
			tools: s.desired.tools.length,
			delivered: s.delivered.length,
			pending: s.pending.length,
			late: s.late.length,
			broken: s.broken,
		}));
	}
}
