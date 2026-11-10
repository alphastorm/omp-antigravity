// The official Antigravity CLI (`agy acp`) as a child process speaking ACP v1 over stdio.
//
// Runtime contract (qualified against agy 1.5.5, see README "Runtime contract"):
// - OMP instructions are appended with `_meta.antigravity.systemPrompt.append` on `session/new`.
// - Native tools, rules, skills, hooks, and ambient MCP are excluded by running the adapter's own
//   custom agent (`excludeDefaultComponents: true`) from an adapter-owned `--gemini-dir`, with an
//   empty adapter-owned directory as the ACP session cwd. One inert conversation-task tool
//   (`manage_task`) and, with MCP attached, `list_resources`/`read_resource` remain declared; any
//   call to a non-bridge tool fails the turn.
// - Client HTTP MCP needs `--process-per-session`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
	ContentBlock,
	InitializeResponse,
	McpServer,
	NewSessionResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionNotification,
	StopReason,
} from "@agentclientprotocol/sdk";
import pkg from "../package.json" with { type: "json" };

export const AGENT_PROFILE = "omp-host";
export const CLIENT_NAME = pkg.name;
export const CLIENT_VERSION = pkg.version;

/** Commands only the default agent offers; seeing one means the restricted profile did not apply. */
const DEFAULT_AGENT_COMMANDS = new Set(["goal", "compact", "swarm", "agy-customizations", "antigravity-guide", "teamwork", "boost"]);

const AGENT_DEFINITION = `---
name: ${AGENT_PROFILE}
description: OMP host session. Instructions and tools are supplied by the OMP host.
mainAgent: true
subagent: false
excludeDefaultComponents: true
---
`;

export type AdapterErrorCode =
	| "spawn"
	| "auth"
	| "capability"
	| "profile"
	| "model_unavailable"
	| "effort_unsupported"
	| "protocol"
	| "timeout"
	| "aborted"
	| "process_exit"
	| "tool_projection"
	| "duplicate_request"
	| "rate_limited";

export class AdapterError extends Error {
	constructor(
		readonly code: AdapterErrorCode,
		message: string,
	) {
		super(message);
		this.name = "AntigravityAcpError";
	}
}

export interface Profile {
	home: string;
	geminiDir: string;
	workspace: string;
}

/** Adapter-owned Antigravity configuration: never the user's ~/.gemini, never the OMP cwd. */
export function ensureProfile(home = process.env.OMP_ANTIGRAVITY_HOME || join(homedir(), ".omp", "antigravity-acp")): Profile {
	if (!isAbsolute(home)) throw new AdapterError("profile", `OMP_ANTIGRAVITY_HOME must be absolute: ${home}`);
	const geminiDir = join(home, "gemini");
	const workspace = join(home, "workspace");
	const agentFile = join(geminiDir, "config", "agents", `${AGENT_PROFILE}.md`);
	mkdirSync(join(geminiDir, "config", "agents"), { recursive: true, mode: 0o700 });
	mkdirSync(workspace, { recursive: true, mode: 0o700 });
	if (!existsSync(agentFile) || readFileSync(agentFile, "utf8") !== AGENT_DEFINITION) {
		writeFileSync(agentFile, AGENT_DEFINITION, { mode: 0o600 });
	}
	return { home, geminiDir, workspace };
}

/** `agy` from OMP_ANTIGRAVITY_AGY, PATH, or the official installer's default location. */
export function resolveAgy(env: NodeJS.ProcessEnv = process.env): string {
	const explicit = env.OMP_ANTIGRAVITY_AGY;
	if (explicit) {
		if (!isAbsolute(explicit) || !existsSync(explicit)) {
			throw new AdapterError("spawn", `OMP_ANTIGRAVITY_AGY must name an existing absolute path: ${explicit}`);
		}
		return explicit;
	}
	const found = Bun.which("agy", { PATH: env.PATH ?? "" }) ?? join(homedir(), ".local", "bin", "agy");
	if (!existsSync(found)) {
		throw new AdapterError(
			"spawn",
			"Antigravity CLI (agy) not found. Install it (https://antigravity.google/docs/install?tab=cli), sign in once with `agy`, or set OMP_ANTIGRAVITY_AGY.",
		);
	}
	return found;
}

const ENV_ALLOW = new Set([
	"HOME",
	"USER",
	"LOGNAME",
	"PATH",
	"SHELL",
	"TMPDIR",
	"LANG",
	"TZ",
	"TERM",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"all_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"NODE_EXTRA_CA_CERTS",
	"__CF_USER_TEXT_ENCODING",
]);

/**
 * Child environment from an allowlist. Provider keys such as GEMINI_API_KEY, GOOGLE_* (ADC), and
 * AGY_ADC_AUTH are dropped so an inherited variable cannot move the CLI onto a paid API route;
 * the CLI keeps its own keychain sign-in. OMP_ANTIGRAVITY_ENV_PASSTHROUGH names deliberate extras.
 */
export function childEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const extra = new Set((env.OMP_ANTIGRAVITY_ENV_PASSTHROUGH ?? "").split(",").map(s => s.trim()).filter(Boolean));
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (ENV_ALLOW.has(key) || key.startsWith("LC_") || key.startsWith("XDG_") || extra.has(key)) out[key] = value;
	}
	return out;
}

export interface AgentHooks {
	onUpdate(notification: SessionNotification): void;
	onPermission(request: RequestPermissionRequest): RequestPermissionResponse;
	onExit(reason: string): void;
}

/** Usage block agy returns on `session/prompt` (draft ACP field, absent from the stable schema). */
export interface PromptUsage {
	inputTokens?: number;
	outputTokens?: number;
	cachedReadTokens?: number;
	cachedWriteTokens?: number;
	thoughtTokens?: number;
	totalTokens?: number;
}

export interface PromptResult {
	stopReason: StopReason;
	usage?: PromptUsage;
}

export interface SessionSelection {
	sessionId: string;
	model: string;
	effort: string | undefined;
	efforts: string[];
}

function deadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	const { promise: timeout, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new AdapterError("timeout", `${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function selectOption(options: SessionConfigOption[] | null | undefined, category: string) {
	const option = options?.find(o => o.type === "select" && (o.category === category || o.id === category));
	if (!option || option.type !== "select") return undefined;
	const values = option.options.flatMap(entry => ("options" in entry ? entry.options : [entry]));
	return { id: option.id, current: option.currentValue, values };
}

export function modelChoices(options: SessionConfigOption[] | null | undefined) {
	return selectOption(options, "model");
}

export function effortChoices(options: SessionConfigOption[] | null | undefined) {
	return selectOption(options, "thought_level");
}

/** One `agy acp` process group owning at most one ACP session. */
export class AgentProcess {
	readonly path: string;
	readonly init: InitializeResponse;
	readonly #proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
	readonly #conn: ReturnType<ReturnType<typeof client>["connect"]>;
	readonly #log: { stderr: string };
	/** agy's own data directory (`<gemini dir>/antigravity-cli`), where it stores each conversation. */
	readonly #appData: string;
	/** Conversations this process created; their transcripts are deleted when it closes. */
	readonly #conversations = new Set<string>();
	#closing: Promise<void> | undefined;

	private constructor(
		path: string,
		proc: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>,
		conn: ReturnType<ReturnType<typeof client>["connect"]>,
		init: InitializeResponse,
		log: { stderr: string },
		geminiDir: string,
	) {
		this.path = path;
		this.#proc = proc;
		this.#conn = conn;
		this.init = init;
		this.#log = log;
		this.#appData = join(geminiDir, "antigravity-cli");
	}

	get pid(): number {
		return this.#proc.pid;
	}

	get exited(): Promise<number> {
		return this.#proc.exited;
	}

	get stderrTail(): string {
		return this.#log.stderr.slice(-4000);
	}

	static async start(options: { profile: Profile; hooks: AgentHooks; signal?: AbortSignal; timeoutMs?: number }): Promise<AgentProcess> {
		const path = resolveAgy();
		const args = [path, "acp", "--process-per-session", "--gemini-dir", options.profile.geminiDir, "--agent", AGENT_PROFILE];
		const proc = Bun.spawn(args, {
			cwd: options.profile.workspace,
			env: childEnv(),
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			detached: true,
		});
		const log = { stderr: "" };
		void (async () => {
			const decoder = new TextDecoder();
			for await (const chunk of proc.stderr) log.stderr = (log.stderr + decoder.decode(chunk, { stream: true })).slice(-16_000);
		})();
		const stdin = new WritableStream<Uint8Array>({
			write(chunk) {
				proc.stdin.write(chunk);
				proc.stdin.flush();
			},
			close() {
				proc.stdin.end();
			},
		});
		const app = client({ name: CLIENT_NAME })
			.onNotification("session/update", ({ params }) => options.hooks.onUpdate(params))
			.onRequest("session/request_permission", ({ params }) => options.hooks.onPermission(params));
		const conn = app.connect(ndJsonStream(stdin, proc.stdout, { maxMessageBytes: 64 * 1024 * 1024 }));
		const kill = () => {
			try {
				process.kill(-proc.pid, "SIGKILL");
			} catch {}
		};
		const onAbort = () => kill();
		options.signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const initialize = conn.agent.request("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
				clientInfo: { name: CLIENT_NAME, title: "OMP Antigravity provider", version: CLIENT_VERSION },
			});
			// Promise.race subscribes to both, so a later exit rejection is handled, not unhandled.
			const exitedEarly = proc.exited.then(code => {
				throw new AdapterError("process_exit", `agy acp exited during startup (code ${code}): ${log.stderr.slice(-800)}`);
			});
			const init = await deadline(Promise.race([initialize, exitedEarly]), options.timeoutMs ?? 30_000, "agy acp initialize");
			if (init.protocolVersion !== PROTOCOL_VERSION) {
				throw new AdapterError("protocol", `agy acp speaks ACP protocol ${init.protocolVersion}; omp-antigravity requires ${PROTOCOL_VERSION}`);
			}
			const agent = new AgentProcess(path, proc, conn, init, log, options.profile.geminiDir);
			void proc.exited.then(code => {
				if (!agent.#closing) options.hooks.onExit(`agy acp exited unexpectedly (code ${code}): ${log.stderr.slice(-800)}`);
			});
			return agent;
		} catch (error) {
			kill();
			conn.close();
			throw options.signal?.aborted ? new AdapterError("aborted", "Antigravity startup aborted") : error;
		} finally {
			options.signal?.removeEventListener("abort", onAbort);
		}
	}

	get capabilities() {
		const caps = this.init.agentCapabilities;
		const meta = caps?._meta as { antigravity?: { systemPrompt?: { append?: boolean } } } | undefined;
		return {
			appendInstructions: meta?.antigravity?.systemPrompt?.append === true,
			httpMcp: caps?.mcpCapabilities?.http === true,
			image: caps?.promptCapabilities?.image === true,
			close: caps?.sessionCapabilities?.close !== undefined,
		};
	}

	/**
	 * Creates the single ACP session with the restricted profile, then selects the exact model and
	 * effort the request named. Selection is confirmed against the values agy reports back.
	 */
	async openSession(spec: {
		workspace: string;
		append: string;
		mcpServer?: McpServer;
		model: string;
		effort: string | undefined;
		signal?: AbortSignal;
	}): Promise<SessionSelection> {
		const caps = this.capabilities;
		if (!caps.appendInstructions) {
			throw new AdapterError("capability", `${this.agentLabel} does not advertise _meta.antigravity.systemPrompt.append`);
		}
		if (spec.mcpServer && !caps.httpMcp) throw new AdapterError("capability", `${this.agentLabel} does not advertise HTTP MCP`);
		let created: NewSessionResponse;
		try {
			created = await deadline(
				this.#conn.agent.request("session/new", {
					cwd: spec.workspace,
					mcpServers: spec.mcpServer ? [spec.mcpServer] : [],
					_meta: { antigravity: { systemPrompt: { append: spec.append } } },
				}),
				120_000,
				"session/new",
			);
		} catch (error) {
			if (isAuthError(error)) {
				throw new AdapterError(
					"auth",
					"Antigravity CLI is not signed in. Run `agy acp --login` (or `agy`) in a terminal and sign in, then retry.",
				);
			}
			throw error;
		}
		const sessionId = created.sessionId;
		this.#conversations.add(sessionId);
		const models = modelChoices(created.configOptions);
		if (!models) throw new AdapterError("capability", `${this.agentLabel} did not advertise a model selector`);
		if (!models.values.some(v => v.value === spec.model)) {
			throw new AdapterError(
				"model_unavailable",
				`Antigravity model "${spec.model}" is not available to this account. Available: ${models.values.map(v => v.value).join(", ")}`,
			);
		}
		let options = created.configOptions;
		if (models.current !== spec.model) {
			const set = await deadline(
				this.#conn.agent.request("session/set_config_option", { sessionId, configId: models.id, value: spec.model }),
				30_000,
				"model selection",
			);
			options = set.configOptions;
		}
		if (modelChoices(options)?.current !== spec.model) {
			throw new AdapterError("model_unavailable", `agy did not confirm model "${spec.model}" (reported ${modelChoices(options)?.current})`);
		}
		const efforts = effortChoices(options);
		let effort = efforts?.current;
		if (spec.effort !== undefined) {
			if (!efforts?.values.some(v => v.value === spec.effort)) {
				throw new AdapterError(
					"effort_unsupported",
					`Antigravity model "${spec.model}" does not offer effort "${spec.effort}". Offered: ${efforts?.values.map(v => v.value).join(", ") || "none"}`,
				);
			}
			if (efforts.current !== spec.effort) {
				const set = await deadline(
					this.#conn.agent.request("session/set_config_option", { sessionId, configId: efforts.id, value: spec.effort }),
					30_000,
					"effort selection",
				);
				options = set.configOptions;
			}
			effort = effortChoices(options)?.current;
			if (effort !== spec.effort || modelChoices(options)?.current !== spec.model) {
				throw new AdapterError("effort_unsupported", `agy did not confirm ${spec.model} at effort "${spec.effort}"`);
			}
		}
		return { sessionId, model: spec.model, effort, efforts: efforts?.values.map(v => v.value) ?? [] };
	}

	prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResult> {
		return this.#conn.agent.request("session/prompt", { sessionId, prompt }) as Promise<PromptResult>;
	}

	cancel(sessionId: string): Promise<void> {
		return this.#conn.agent.notify("session/cancel", { sessionId });
	}

	get agentLabel(): string {
		return `${this.init.agentInfo?.name ?? "agy acp"} ${this.init.agentInfo?.version ?? "?"}`;
	}

	/** Idempotent teardown: end stdin, TERM then KILL the process group, then drop agy's transcripts. */
	close(): Promise<void> {
		this.#closing ??= (async () => {
			try {
				this.#conn.close();
			} catch {}
			try {
				this.#proc.stdin.end();
			} catch {}
			const signal = (sig: NodeJS.Signals) => {
				try {
					process.kill(-this.#proc.pid, sig);
				} catch {}
			};
			signal("SIGTERM");
			const exited = await Promise.race([this.#proc.exited.then(() => true), Bun.sleep(2000).then(() => false)]);
			if (!exited) {
				signal("SIGKILL");
				await Promise.race([this.#proc.exited, Bun.sleep(1000)]);
			}
			this.#forgetConversations();
		})();
		return this.#closing;
	}

	/** Synchronous last-resort kill for process exit handlers. */
	killNow(): void {
		try {
			process.kill(-this.#proc.pid, "SIGKILL");
		} catch {}
		this.#forgetConversations();
	}

	/**
	 * agy keeps a full transcript of every conversation (prompts, tool output) under its data
	 * directory and offers no delete RPC. OMP's session file is the record, so the copy is removed
	 * once the process is gone. OMP_ANTIGRAVITY_DEBUG keeps it for diagnosis.
	 */
	#forgetConversations(): void {
		if (process.env.OMP_ANTIGRAVITY_DEBUG) return;
		for (const id of this.#conversations) {
			if (!/^[\w-]+$/.test(id)) continue;
			const conversations = join(this.#appData, "conversations");
			for (const target of [
				join(this.#appData, "brain", id),
				join(this.#appData, "annotations", `${id}.pbtxt`),
				join(conversations, `${id}.db`),
				join(conversations, `${id}.db-wal`),
				join(conversations, `${id}.db-shm`),
			]) {
				try {
					rmSync(target, { recursive: true, force: true });
				} catch {}
			}
		}
		this.#conversations.clear();
	}

	/**
	 * Lists the account's models and each model's effort levels without generating anything:
	 * one bare session, then model selection only. Throws AdapterError("auth") when signed out.
	 */
	async catalog(workspace: string): Promise<CatalogEntry[]> {
		let created: NewSessionResponse;
		try {
			created = await deadline(
				this.#conn.agent.request("session/new", {
					cwd: workspace,
					mcpServers: [],
					_meta: { antigravity: { systemPrompt: { append: "Model catalog probe; no prompt follows." } } },
				}),
				20_000,
				"session/new",
			);
		} catch (error) {
			if (isAuthError(error)) {
				throw new AdapterError("auth", "Antigravity CLI is not signed in. Run `agy acp --login` (or `agy`) in a terminal and sign in.");
			}
			throw error;
		}
		this.#conversations.add(created.sessionId);
		const models = modelChoices(created.configOptions);
		if (!models) return [];
		const entries: CatalogEntry[] = [];
		let options = created.configOptions;
		for (const choice of models.values) {
			if (modelChoices(options)?.current !== choice.value) {
				const set = await deadline(
					this.#conn.agent.request("session/set_config_option", { sessionId: created.sessionId, configId: models.id, value: choice.value }),
					10_000,
					"model selection",
				);
				options = set.configOptions;
			}
			const efforts = effortChoices(options);
			entries.push({ id: choice.value, name: choice.name, efforts: efforts?.values.map(v => v.value) ?? [], defaultEffort: efforts?.current });
		}
		if (this.capabilities.close) {
			await deadline(this.#conn.agent.request("session/close", { sessionId: created.sessionId }), 5000, "session/close").catch(() => {});
		}
		return entries;
	}
}

export interface CatalogEntry {
	id: string;
	name: string;
	efforts: string[];
	defaultEffort: string | undefined;
}

/** True when the restricted profile visibly did not apply (default-agent commands were offered). */
export function defaultAgentLeak(commands: readonly string[]): string | undefined {
	return commands.find(name => DEFAULT_AGENT_COMMANDS.has(name));
}

function isAuthError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = "code" in error ? error.code : undefined;
	const message = "message" in error && typeof error.message === "string" ? error.message : "";
	return code === -32000 || /authentication required/i.test(message);
}
