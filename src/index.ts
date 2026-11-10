// omp-antigravity: OMP provider `antigravity-acp` backed by the official Antigravity CLI over ACP.
// OMP keeps its tools, policy, transcript, skills, and task orchestration; Antigravity supplies the model.
import * as piAi from "@oh-my-pi/pi-ai";
import type { AssistantMessageEventStream as EventStream } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";
import { AgentProcess, ensureProfile } from "./acp.ts";
import { doctor, formatReport } from "./doctor.ts";
import { PROVIDER, Runtime } from "./session.ts";


// The root export is the documented runtime entry (docs/extensions.md "Command-backed providers"), but
// pi-ai's type barrel re-exports the name type-only alongside the class, so TS cannot see the value.
const { AssistantMessageEventStream } = piAi as unknown as { AssistantMessageEventStream: new () => EventStream };
const OMP_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * agy reports no context or output limits. Documented conservative mapping by model family
 * (README "Model metadata"); OMP estimates occupancy itself and compacts against this window.
 */
function limitsFor(id: string): { contextWindow: number; maxTokens: number } {
	if (id.startsWith("gemini-")) return { contextWindow: 500_000, maxTokens: 64_000 };
	if (id.startsWith("claude-")) return { contextWindow: 200_000, maxTokens: 64_000 };
	return { contextWindow: 128_000, maxTokens: 32_000 };
}

async function discoverModels(): Promise<ProviderModelConfig[]> {
	const profile = ensureProfile();
	const agent = await AgentProcess.start({
		profile,
		timeoutMs: 10_000,
		hooks: { onUpdate() {}, onPermission: () => ({ outcome: { outcome: "cancelled" } }), onExit() {} },
	});
	try {
		const image = agent.capabilities.image;
		const catalog = await agent.catalog(profile.workspace);
		return catalog.map(entry => {
			const efforts = entry.efforts.filter(e => OMP_EFFORTS.has(e)) as NonNullable<ProviderModelConfig["thinking"]>["efforts"][number][];
			const defaultLevel = efforts.find(e => e === entry.defaultEffort);
			return {
				id: entry.id,
				name: `${entry.name} (Antigravity)`,
				api: PROVIDER,
				reasoning: efforts.length > 0,
				...(efforts.length ? { thinking: { mode: "effort" as const, efforts, ...(defaultLevel ? { defaultLevel } : {}) } } : {}),
				input: image ? ["text", "image"] : ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				...limitsFor(entry.id),
			};
		});
	} finally {
		await agent.close();
	}
}

interface Installed {
	modulePath: string;
	runtime: Runtime;
}

const INSTALLED = Symbol.for("omp-antigravity.installed");

/** One runtime per OMP process; a second copy of the package refuses to register. */
function installedRuntime(): Runtime {
	const host = globalThis as typeof globalThis & { [INSTALLED]?: Installed };
	const existing = host[INSTALLED];
	if (existing && existing.modulePath !== import.meta.path) {
		throw new Error(
			`omp-antigravity is loaded twice (${existing.modulePath} and ${import.meta.path}); keep one installation of the antigravity-acp provider`,
		);
	}
	if (existing) return existing.runtime;
	const runtime = new Runtime();
	host[INSTALLED] = { modulePath: import.meta.path, runtime };
	process.once("exit", () => runtime.killAll());
	return runtime;
}

function emit(pi: ExtensionAPI, ctx: ExtensionCommandContext, message: string): void {
	if (ctx.mode === "print") process.stdout.write(`${message}\n`);
	else if (ctx.hasUI) ctx.ui.notify(message, "info");
	else pi.sendMessage({ customType: "antigravity-doctor", content: message, display: true });
}

export default function ompAntigravity(pi: ExtensionAPI): void {
	const runtime = installedRuntime();

	pi.registerProvider(PROVIDER, {
		// Command-backed provider: no HTTP endpoint and no OMP-held credential. agy owns its sign-in.
		baseUrl: "https://antigravity-acp.invalid/",
		apiKey: "agy-cli-managed-sign-in",
		api: PROVIDER,
		streamSimple(model, context, options) {
			const stream = new AssistantMessageEventStream();
			void runtime.stream(model, context, options ?? {}, stream);
			return stream;
		},
		fetchDynamicModels: () => discoverModels(),
	});

	pi.on("cache_warming_decision", (_event, ctx) => {
		// A warming replay would be a real Antigravity generation, not a cache read.
		if (ctx.model?.provider === PROVIDER) return { action: "stop" };
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		await Promise.race([runtime.closeAll("OMP shut down"), Bun.sleep(1500)]);
		runtime.killAll();
	});

	pi.registerCommand("antigravity-doctor", {
		description: "Check the Antigravity CLI runtime (no generation): executable, sign-in, capabilities, models, live sessions",
		handler: async (_args, ctx) => {
			const report = formatReport(await doctor());
			const live = runtime.snapshot();
			const rebuilds = runtime.recentRebuilds();
			emit(
				pi,
				ctx,
				[
					report,
					`live sessions: ${live.length ? "" : "none"}`,
					...live.map(s => `  ${JSON.stringify(s)}`),
					...(rebuilds.length ? ["recent rebuilds:", ...rebuilds.map(r => `  ${new Date(r.at).toISOString()} ${r.key}: ${r.reason}`)] : []),
				].join("\n"),
			);
		},
	});
}
