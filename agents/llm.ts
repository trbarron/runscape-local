// Planner client: GPT-6 Luna through the OpenAI Responses API, with a hard budget.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { emit } from './events';

const MODEL = process.env.PLANNER_MODEL ?? 'gpt-6-luna';
// USD per 1M tokens (GPT-6 Luna, standard processing). Cache writes bill at 1.25x input.
const PRICE = { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 };

const ledgerPath = join(import.meta.dir, 'runs', 'ledger.json');
const BUDGET_USD = Number(process.env.BUDGET_USD ?? 24.77);

interface Ledger {
    spentUsd: number;
    calls: number;
    inputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
}

const ledger: Ledger = {
    spentUsd: 0,
    calls: 0,
    inputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...(existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf-8')) : {})
};

export const spend = () => ({ ...ledger, budgetUsd: BUDGET_USD, model: MODEL });
export const budgetLeft = () => BUDGET_USD - ledger.spentUsd;

function apiKey(): string {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    const envFile = join(import.meta.dir, '..', '.env');
    if (existsSync(envFile)) {
        const m = readFileSync(envFile, 'utf-8').match(/^OPENAI_API_KEY=(.+)$/m);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    throw new Error('OPENAI_API_KEY not set (put it in runscape-local/.env)');
}

export class BudgetExceeded extends Error {}

/**
 * A bot can run on another model through an OpenAI-compatible chat endpoint (a local Ollama,
 * Kimi's API): `agents/models.json` maps a bot to {baseUrl, model, apiKeyEnv?, price?}. It is
 * read on every call, so a bot can be moved onto a model or back without a restart. Calls to it
 * cost its `price` (USD per 1M tokens; local models are free) and a failed call falls back to
 * the default model so the bot is never left without a planner.
 */
interface BotModel {
    baseUrl: string;
    model: string;
    /** Name of the environment variable (or .env entry) holding the API key, if one is needed. */
    apiKeyEnv?: string;
    price?: { input: number; output: number };
    timeoutMs?: number;
}
const modelsPath = join(import.meta.dir, 'models.json');
const botModel = (bot: string): BotModel | undefined => {
    try {
        return existsSync(modelsPath) ? (JSON.parse(readFileSync(modelsPath, 'utf-8')) as Record<string, BotModel>)[bot] : undefined;
    } catch {
        return undefined;
    }
};
function keyFor(name?: string): string | undefined {
    if (!name) return undefined;
    if (process.env[name]) return process.env[name];
    const envFile = join(import.meta.dir, '..', '.env');
    const m = existsSync(envFile) ? readFileSync(envFile, 'utf-8').match(new RegExp(`^${name}=(.+)$`, 'm')) : null;
    return m?.[1].trim().replace(/^["']|["']$/g, '');
}

async function planOther<T>(bot: string, cfg: BotModel, system: string, user: string, schema: object, maxOutput: number): Promise<T> {
    const started = Date.now();
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(keyFor(cfg.apiKeyEnv) ? { authorization: `Bearer ${keyFor(cfg.apiKeyEnv)}` } : {}) },
        body: JSON.stringify({
            model: cfg.model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ],
            max_tokens: maxOutput,
            temperature: 0.7,
            response_format: { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema } }
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 180_000)
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    const inTok = json.usage?.prompt_tokens ?? 0;
    const outTok = json.usage?.completion_tokens ?? 0;
    const cost = cfg.price ? (inTok * cfg.price.input + outTok * cfg.price.output) / 1e6 : 0;
    ledger.spentUsd += cost;
    ledger.calls++;
    ledger.inputTokens += inTok;
    ledger.outputTokens += outTok;
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    emit(bot, 'spend', { inTok, outTok, cached: 0, writes: 0, costUsd: cost, totalUsd: ledger.spentUsd, model: cfg.model, ms: Date.now() - started });
    // Some models wrap JSON in a code fence or add a leading thought: take the outermost object.
    const text: string = json.choices?.[0]?.message?.content ?? '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as T;
}

/** One structured-output call. Throws BudgetExceeded once the cap is hit. */
export async function plan<T>(bot: string, system: string, user: string, schema: object, maxOutput = 500): Promise<T> {
    if (budgetLeft() <= 0) throw new BudgetExceeded(`budget of $${BUDGET_USD} spent`);

    const other = botModel(bot);
    if (other) {
        try {
            return await planOther<T>(bot, other, system, user, schema, maxOutput);
        } catch (err: any) {
            emit(bot, 'info', { summary: `${other.model} failed (${String(err?.message ?? err).slice(0, 120)}): using ${MODEL} for this decision` });
        }
    }

    const body = {
        model: MODEL,
        input: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        reasoning: { effort: 'none' },
        max_output_tokens: maxOutput,
        // Keeps each agent's calls (which share its system prompt) on the same cache.
        prompt_cache_key: `rs-party-${bot}`,
        text: { format: { type: 'json_schema', name: 'plan', strict: true, schema } }
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
        try {
            const res = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(60_000)
            });
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
            const json: any = await res.json();
            if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? `HTTP ${res.status}`), { fatal: true });

            const usage = json.usage ?? {};
            const cached = usage.input_tokens_details?.cached_tokens ?? 0;
            const writes = usage.input_tokens_details?.cache_write_tokens ?? 0;
            const inTok = usage.input_tokens ?? 0;
            const outTok = usage.output_tokens ?? 0;
            const uncached = Math.max(0, inTok - cached - writes);
            const cost = (uncached * PRICE.input + cached * PRICE.cachedInput + writes * PRICE.cacheWrite + outTok * PRICE.output) / 1e6;
            ledger.spentUsd += cost;
            ledger.calls++;
            ledger.inputTokens += inTok;
            ledger.cachedTokens += cached;
            ledger.cacheWriteTokens += writes;
            ledger.outputTokens += outTok;
            writeFileSync(ledgerPath, JSON.stringify(ledger));
            emit(bot, 'spend', { inTok, outTok, cached, writes, costUsd: cost, totalUsd: ledger.spentUsd });

            const text = (json.output ?? [])
                .flatMap((o: any) => o.content ?? [])
                .filter((c: any) => c.type === 'output_text')
                .map((c: any) => c.text)
                .join('');
            return JSON.parse(text) as T;
        } catch (err: any) {
            lastErr = err;
            if (err?.fatal) break;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
