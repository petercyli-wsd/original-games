// Local side of the AI evaluator, for reviews run in Claude Code on the
// subscription (see .claude/skills). It does the plumbing; Claude Code does
// the thinking:
//
//   todo [--all]                       games needing a review under the active prompt
//   prepare <id...>                    evidence + rules-card prompt (reuses a cached card)
//   player-prompt <id...> [--version N] [--pool train] [--players N]
//                                      the blind player prompt (UI only) for each game, under
//                                      an alias so the player never learns which game it is;
//                                      --players N makes N aliases, one per independent play,
//                                      merged into one review (medians, majority checks);
//                                      --more adds the N plays to the game's current panel
//   play <alias> "<steps>"             the blind player's only tool: plays the UI with prose
//                                      hidden, saves numbered screenshots to .evaluator/<id>/ui/
//   judge-prompt <id...> [--version N] [--pool train]
//                                      the designer judge prompt (uses player.json if present)
//   submit <id...> [--model name]      validate review.json (+ player.json) and store it via the API;
//                                      with the API down it queues them, and `submit --pending` sends the queue
//   refine-prompt                      the refine prompt over train games
//   submit-version                     store .evaluator/_refine/proposal.json as a candidate
//   calibration [--version N]          what to review to backtest a version
//   score <version>                    recompute agreement metrics from stored reviews
//   promote <version>                  make a version active
//   seed-version ["changelog"]         store the rubric in apps/api/src/evaluator/rubric.ts as a candidate
//   results [--json]                   every AI-reviewed game ranked by overall, with facet scores
//   gate <id...> [--all] [--json]      pass/fail each game's latest review against the keep gate
//                                      (overall >= 3.5, each clarity facet >= 3, no reskin, no dead
//                                      structure); a game the team has rated passes on the team's
//                                      average >= 3.5 instead. Exits 1 if any game fails
//   preview <id...> [--json]           score the local review.json + player panel with the API's code,
//                                      store nothing, and check the gate
//   review <id...>                     a game's latest AI review and its team reviews, for iterating
//
// Needs ORIGINALS_API_URL and ORIGINALS_ADMIN_KEY (in .env.local at the repo root).
// When the API is unreachable, prepare, player-prompt, judge-prompt, gate, preview
// and review run on the API's code locally, from the version and team reviews
// cached in .evaluator/ the last time it answered; submit queues. An
// .evaluator/_local file forces the same while the API is up (team reviews
// still refresh), to roll out a version the API doesn't have yet.
// Working files live in .evaluator/<id>/ (git-ignored).

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { evalTable, measuredChecks, type GameEvidence } from '../apps/api/src/evaluator/evidence';
import { EXTRACT_SYSTEM, RULES_CARD_SCHEMA, extractUser } from '../apps/api/src/evaluator/prompts';
import { mergePlayers } from '../apps/api/src/evaluator/panel';
import { DEFAULT_CRITERIA, DEFAULT_GUIDANCE } from '../apps/api/src/evaluator/rubric';
import type { PlayerOutput } from '../apps/api/src/evaluator/service';
import { FACETS, type EvaluationSummary, type MeasuredCheck, type PromptVersion } from '../apps/api/src/shared';
import { GAMES_DIR, ROOT, buildGameEvidence, codeHashOf, gameIds, gameplayFiles } from './lib/game-evidence';

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: 'string' },
    pool: { type: 'string' },
    players: { type: 'string', default: '1' },
    model: { type: 'string' },
    all: { type: 'boolean' },
    json: { type: 'boolean' },
    pending: { type: 'boolean' },
    more: { type: 'boolean' },
    rounds: { type: 'string', default: '20000' },
  },
});
const [command, ...ids] = positionals;
const WORK = join(ROOT, '.evaluator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiBase(): string {
  const raw = process.env.ORIGINALS_API_URL?.trim();
  if (!raw) fail('Set ORIGINALS_API_URL in .env.local (the API service URL, e.g. https://original-games.onrender.com).');
  return raw.replace(/\/+$/, '');
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.ORIGINALS_ADMIN_KEY ?? '';
  const res = await fetch(apiBase() + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-admin-key': key },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) fail(`${init.method ?? 'GET'} ${path}: ${body.error ?? res.status}${res.status === 401 ? ' (check ORIGINALS_ADMIN_KEY in .env.local)' : ''}`);
  return body;
}

const dir = (id: string) => {
  const d = join(WORK, id);
  mkdirSync(d, { recursive: true });
  return d;
};
const write = (path: string, data: unknown) => writeFileSync(path, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
const readJson = <T>(path: string): T => {
  if (!existsSync(path)) fail(`Missing ${relative(ROOT, path)}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    fail(`${relative(ROOT, path)} is not valid JSON`);
  }
};
const rel = (path: string) => relative(ROOT, path).replaceAll('\\', '/');
const isAnchor = (id: string) => id.startsWith('anchor-');
const promptFile = (system: string, user: string, schemaPath: string) =>
  `<!-- Generated by scripts/evaluator.ts. Follow the SYSTEM section as your instructions, then answer the USER section. -->

# SYSTEM

${system}

# USER

${user}

# OUTPUT

Reply with a single JSON object only (no prose, no code fences) that matches the schema in ${schemaPath}.
`;

// ---------------------------------------------------------------------------
// Working without the API
// ---------------------------------------------------------------------------
// Prompt building and scoring are the API's own code, so they also run here
// on in-memory stores: the active version and the team's reviews are cached
// whenever the API answers. Submissions made while it is down are queued in
// .evaluator/_pending.json for `submit --pending`.

const ACTIVE_CACHE = join(WORK, '_active-version.json');
const TEAM_CACHE = join(WORK, '_team-reviews.json');
const PENDING = join(WORK, '_pending.json');

// .evaluator/_local makes the CLI work locally even when the API answers: prompts
// and scores come from this checkout's code under the cached version, and
// submissions queue. Use it to roll out a prompt version before the API has it.
const LOCAL = existsSync(join(WORK, '_local'));

let reachable: Promise<boolean> | undefined;
const reachableApi = () =>
  (reachable ??= fetch(`${apiBase()}/health`, { signal: AbortSignal.timeout(15_000) })
    .then((r) => r.ok)
    .catch(() => false)
    .then((ok) => {
      if (!ok) console.log('! The API is unreachable: working from the cached active version and team reviews in .evaluator/.');
      else if (LOCAL) console.log(`! Local mode (.evaluator/_local): working from the cached active version; submissions queue.`);
      return ok;
    }));
/** Whether to use the API for prompts, stored reviews and submissions. */
const online = async () => (await reachableApi()) && !LOCAL;

type TeamReview = { gameId: string; reviewer?: string; stars: number; comment?: string; facets?: Record<string, number> };

/** The active prompt version and the team's reviews: live (and cached) when the API answers, else the cache. */
async function shared(): Promise<{ active: PromptVersion; team: TeamReview[] }> {
  if (await reachableApi()) {
    // The team's reviews are always refreshed; the version only when not in local mode.
    const team = await api<TeamReview[] | { reviews: TeamReview[] }>('/reviews');
    write(TEAM_CACHE, Array.isArray(team) ? team : team.reviews);
    if (!LOCAL) write(ACTIVE_CACHE, (await api<{ activeVersion: PromptVersion }>('/evaluator')).activeVersion);
  }
  if (!existsSync(ACTIVE_CACHE) || !existsSync(TEAM_CACHE)) fail('The API is unreachable and .evaluator/ has no cached active version or team reviews.');
  return { active: readJson<PromptVersion>(ACTIVE_CACHE), team: readJson<TeamReview[]>(TEAM_CACHE) };
}

/**
 * The API's evaluator on in-memory stores, seeded with the active version,
 * the team's reviews, every prepared game's evidence and its cached rules card.
 * Prompts and scores from it match the API's.
 */
let localCache: ReturnType<typeof buildLocal> | undefined;
const local = () => (localCache ??= buildLocal());
async function buildLocal() {
  const { createEvaluator } = await import('../apps/api/src/evaluator/service');
  const { createMemoryEvalStore, createMemoryStore } = await import('../apps/api/src/store');
  const { active, team } = await shared();
  const evals = createMemoryEvalStore();
  const version = await evals.createVersion({ parentId: null, status: 'candidate', criteria: active.criteria, guidance: active.guidance, exemplars: active.exemplars, changelog: '' });
  await evals.promote(version.id);
  const index = new Map<string, GameEvidence>();
  for (const id of readdirSync(WORK)) {
    const f = join(WORK, id, 'evidence.json');
    if (id.startsWith('_') || !existsSync(f)) continue;
    const evidence = readJson<GameEvidence>(f);
    index.set(id, evidence);
    const card = join(WORK, id, 'card.json');
    if (!existsSync(card)) continue;
    // A card that doesn't match the schema would break every prompt that lists it as a reference.
    const missing = RULES_CARD_SCHEMA.required.filter((k) => !(k in readJson<Record<string, unknown>>(card)));
    if (missing.length) console.log(`! ${id}: card.json is missing ${missing.join(', ')}; rerun its rules-card step. Left out of the catalogue.`);
    else await evals.saveRulesCard(id, evidence.codeHash, readJson(card), 'cached');
  }
  const ratings = createMemoryStore();
  for (const [i, r] of team.entries()) await ratings.upsert(r.gameId, `voter-${r.reviewer || `anon-${i}`}`, r.stars, r.comment ?? '', r.reviewer ?? '', (r.facets ?? {}) as never);
  const evaluator = createEvaluator({ llm: null, evals, ratings, evidence: { get: (g) => index.get(g), all: () => [...index.values()] } });
  const teamAverage = new Map((await evaluator.agreement()).rows.map((r) => [r.gameId, r.humanAverage]));
  return { evaluator, localVersionId: version.id, active, team, teamAverage };
}

/** A player or judge prompt built locally, as the API would, under the cached active version. */
async function offlinePrompt(
  kind: 'player' | 'judge',
  body: { versionId?: number; [k: string]: unknown },
): Promise<{ versionId: number; system: string; user: string; schema: unknown; references?: number }> {
  const { evaluator, active } = await local();
  if (body.versionId && body.versionId !== active.id) fail(`Offline, only the cached active version v${active.id} is available.`);
  if (body.anchorId) fail('Anchors need the API.');
  const input = { ...body, versionId: undefined } as never;
  const p = kind === 'player' ? await evaluator.playerPrompt(input) : await evaluator.judgePrompt(input);
  return { ...p, versionId: active.id };
}

/** Scores a game's local review files with the API's code, storing nothing. */
async function scoreLocal(id: string) {
  const d = dir(id);
  const { evaluator, localVersionId } = await local();
  const evidence = readJson<GameEvidence>(join(d, 'evidence.json'));
  return evaluator.importEvaluation({
    gameId: id,
    versionId: localVersionId,
    codeHash: evidence.codeHash,
    card: readJson(join(d, 'card.json')),
    review: readJson(join(d, 'review.json')),
    player: readPlayer(id),
    checks: measuredChecks(evidence),
    collection: evidence.manifest.collection,
  });
}

/** Hash of a game's gameplay source, computed the same way as the evidence builder. */
const localCodeHash = (id: string) => codeHashOf(gameplayFiles(join(GAMES_DIR, id, 'src')));

function requireIds() {
  if (!ids.length) fail(`Usage: npm run evaluator -- ${command} <game-id...>`);
  return ids;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function todo() {
  const summaries = await api<Record<string, EvaluationSummary & { codeHash?: string }>>('/evaluations');
  const status = await api<{ activeVersion: { id: number } }>('/evaluator');
  const out = gameIds()
    .filter((id) => !id.startsWith('template'))
    .filter((id) => values.all || summaries[id]?.codeHash !== localCodeHash(id));
  console.log(`Active prompt v${status.activeVersion.id}. ${out.length} game(s) ${values.all ? 'in total' : 'need a review (never reviewed, or code changed)'}:`);
  console.log(out.join(' '));
}

async function prepare() {
  for (const id of requireIds()) {
    const d = dir(id);
    const previous = existsSync(join(d, 'evidence.json')) ? readJson<GameEvidence>(join(d, 'evidence.json')).codeHash : undefined;
    const evidence = (await buildGameEvidence(id, Number(values.rounds))) as GameEvidence;
    write(join(d, 'evidence.json'), evidence);
    write(join(d, 'card.schema.json'), RULES_CARD_SCHEMA);
    // Offline, the local card is reused only if the code hasn't changed since it was written.
    const cached = (await online())
      ? await api<unknown>(`/evaluator/cards/${id}?hash=${evidence.codeHash}`)
      : previous === evidence.codeHash && existsSync(join(d, 'card.json'))
        ? readJson(join(d, 'card.json'))
        : null;
    if (!cached) rmSync(join(d, 'card.json'), { force: true });
    if (cached) {
      write(join(d, 'card.json'), cached);
      console.log(`✓ ${id}: rules card cached for this code version → ${rel(join(d, 'card.json'))} (skip the card step)`);
    } else {
      write(join(d, 'extract.md'), promptFile(EXTRACT_SYSTEM, extractUser(evidence.manifest, evidence.files), rel(join(d, 'card.schema.json'))));
      console.log(`✓ ${id}: needs a rules card → read ${rel(join(d, 'extract.md'))}, write ${rel(join(d, 'card.json'))}`);
    }
  }
}

const PLAY_TOOL = (alias: string) =>
  `npm run evaluator -- play ${alias} "<steps>"
Steps are separated by ";": shot:<name> (screenshot), text:<label> (click the first enabled button whose visible text contains <label>), mouse:<x>,<y> (click at screen coordinates, 1280x800), key:<Space|Enter|Escape|letter>, wait:<ms>.
Each call starts a fresh page and plays your steps in order, so include every step from the start. Take a shot after each action you want to see. Example: npm run evaluator -- play ${alias} "shot:start;text:Bet;wait:1200;shot:after-bet"
The command prints the screenshot paths; open them with Read.`;

// The blind player works under an alias in .evaluator/_blind/<alias>/, so
// nothing it reads, runs or writes names the game. The alias → id map stays
// with the CLI.
const BLIND = join(WORK, '_blind');
const blindMapFile = join(BLIND, 'map.json');
const blindMap = (): Record<string, string> => (existsSync(blindMapFile) ? readJson<Record<string, string>>(blindMapFile) : {});
// One file per alias as well, so parallel player-prompt runs can't lose each other's entries in map.json.
const aliasFile = (alias: string) => join(BLIND, '_map', alias);
const gameOfAlias = (alias: string): string | undefined =>
  existsSync(aliasFile(alias)) ? readFileSync(aliasFile(alias), 'utf8').trim() : blindMap()[alias];

/** Where a game's blind player reviews are: the alias folders of its latest player prompt (one per panel member). */
function playerFiles(id: string): string[] {
  const meta = join(dir(id), 'player.meta.json');
  const m = existsSync(meta) ? readJson<{ alias?: string; aliases?: string[] }>(meta) : {};
  const aliases = m.aliases ?? (m.alias ? [m.alias] : []);
  return aliases.length ? aliases.map((a) => join(BLIND, a, 'player.json')) : [join(dir(id), 'player.json')];
}

/** The game's blind player review, merged across the panel; undefined when no play has been written yet. */
function readPlayer(id: string): unknown {
  const files = playerFiles(id).filter((f) => existsSync(f));
  if (!files.length) return undefined;
  const missing = playerFiles(id).length - files.length;
  if (missing) console.log(`! ${id}: ${missing} of ${playerFiles(id).length} panel plays missing; merging the ${files.length} written`);
  return mergePlayers(files.map((f) => readJson<PlayerOutput>(f)));
}

async function playerPrompt() {
  const panel = Math.max(1, Number(values.players) || 1);
  for (const id of requireIds()) {
    const d = dir(id);
    const versionId = values.version ? Number(values.version) : undefined;
    const pool = values.pool === 'train' ? 'train' : 'all';
    // --more adds the new plays to the game's current panel instead of starting a new one.
    const current = values.more && existsSync(join(d, 'player.meta.json')) ? readJson<{ aliases?: string[]; alias?: string }>(join(d, 'player.meta.json')) : {};
    const aliases: string[] = current.aliases ?? (current.alias ? [current.alias] : []);
    for (let i = 0; i < panel; i++) {
      const alias = `g-${randomBytes(3).toString('hex')}`;
      const b = join(BLIND, alias);
      mkdirSync(b, { recursive: true });
      mkdirSync(join(BLIND, '_map'), { recursive: true });
      write(aliasFile(alias), id);
      write(blindMapFile, { ...blindMap(), [alias]: id });
      const body = { gameId: id, versionId, pool, tool: PLAY_TOOL(alias) } as const;
      const p = (await online())
        ? await api<{ versionId: number; system: string; user: string; schema: unknown }>('/evaluator/player-prompt', { method: 'POST', body })
        : await offlinePrompt('player', body);
      write(join(b, 'player.schema.json'), p.schema);
      write(join(b, 'player.md'), promptFile(p.system, p.user, rel(join(b, 'player.schema.json'))));
      write(join(d, 'player.meta.json'), { versionId: p.versionId, pool, alias: aliases[0] ?? alias, aliases: [...aliases, alias] });
      aliases.push(alias);
      console.log(`✓ ${id}: blind player prompt v${p.versionId} as ${alias} → read ${rel(join(b, 'player.md'))}, write ${rel(join(b, 'player.json'))}`);
    }
    rmSync(join(d, 'player.json'), { force: true });
  }
}

/** The blind player's sandbox: plays the game's UI with prose hidden and only player actions allowed. */
async function play() {
  const [name, steps] = ids;
  if (!name || !steps) fail('Usage: npm run evaluator -- play <alias> "<steps>"');
  const id = gameOfAlias(name) ?? name;
  if (!gameIds().includes(id)) fail(`No game ${name}`);
  const uiDir = join(id === name ? dir(id) : join(BLIND, name), 'ui');
  mkdirSync(uiDir, { recursive: true });
  const run = readdirSync(uiDir).filter((f) => f.startsWith('run-')).length + 1;
  const out = join(uiDir, `run-${run}`);
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'play.mjs'), id, '--blind', '--size', '1280x800', '--out', out, '--steps', steps], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => /^(text|shot|✗|✓)|not allowed/.test(l.trim()))
    .map((l) => l.replace(/^shot\s+/, 'screenshot: ').replaceAll('\\', '/'))
    .join('\n');
  console.log(`Run ${run}:\n${text}`);
}

async function judgePrompt() {
  for (const id of requireIds()) {
    const d = dir(id);
    const versionId = values.version ? Number(values.version) : undefined;
    const pool = values.pool === 'train' ? 'train' : 'all';
    let body: Record<string, unknown>;
    if (isAnchor(id)) {
      body = { anchorId: id, versionId, pool };
    } else {
      const evidence = readJson<GameEvidence>(join(d, 'evidence.json'));
      const checks = measuredChecks(evidence);
      body = {
        gameId: id,
        name: evidence.manifest.name,
        mechanic: evidence.manifest.mechanic,
        collection: evidence.manifest.collection,
        card: readJson(join(d, 'card.json')),
        facts: checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.label}: ${c.detail}`).join('\n'),
        table: evalTable(evidence),
        versionId,
        pool,
        player: readPlayer(id),
      };
      // The merged panel review, kept beside the designer prompt for reference.
      if (body.player !== undefined) write(join(d, 'player.json'), body.player);
    }
    const p = (await online())
      ? await api<{ versionId: number; system: string; user: string; schema: unknown; references: number }>('/evaluator/judge-prompt', { method: 'POST', body })
      : await offlinePrompt('judge', body);
    write(join(d, 'review.schema.json'), p.schema);
    write(join(d, 'judge.md'), promptFile(p.system, p.user, rel(join(d, 'review.schema.json'))));
    write(join(d, 'judge.meta.json'), { versionId: p.versionId, pool });
    console.log(`✓ ${id}: prompt v${p.versionId}, ${p.references} reference game(s) → read ${rel(join(d, 'judge.md'))}, write ${rel(join(d, 'review.json'))}`);
  }
}

async function submit() {
  const pending = existsSync(PENDING) ? readJson<string[]>(PENDING) : [];
  const targets = values.pending ? pending : requireIds();
  if (!(await online())) {
    write(PENDING, [...new Set([...pending, ...targets])]);
    console.log(`! Queued ${targets.join(' ')} in ${rel(PENDING)}. Run \`npm run evaluator -- submit --pending\` once the API is back.`);
    return;
  }
  for (const id of targets) {
    const d = dir(id);
    const meta = readJson<{ versionId: number }>(join(d, 'judge.meta.json'));
    const review = readJson(join(d, 'review.json'));
    const model = values.model ?? 'claude-code';
    let body: Record<string, unknown>;
    if (isAnchor(id)) {
      body = { anchorId: id, versionId: meta.versionId, review, model };
    } else {
      const evidence = readJson<GameEvidence>(join(d, 'evidence.json'));
      const checks: MeasuredCheck[] = measuredChecks(evidence);
      const player = readPlayer(id);
      body = { gameId: id, versionId: meta.versionId, codeHash: evidence.codeHash, card: readJson(join(d, 'card.json')), review, player, checks, model, collection: evidence.manifest.collection };
    }
    const saved = await api<{ overall: number; recommendation: string; verdict: string }>('/evaluations/import', { method: 'POST', body });
    write(join(d, 'submitted.json'), saved);
    console.log(`✓ ${id}: ${saved.overall.toFixed(2)}/5 (${saved.recommendation}) under v${meta.versionId}. ${saved.verdict}`);
    if (existsSync(PENDING)) write(PENDING, readJson<string[]>(PENDING).filter((p) => p !== id));
  }
}

async function refinePrompt() {
  const d = dir('_refine');
  const p = await api<{ activeVersionId: number; train: string[]; holdout: string[]; missing: string[]; system: string; user: string; schema: unknown }>(
    '/evaluator/refine-prompt',
  );
  write(join(d, 'proposal.schema.json'), p.schema);
  write(join(d, 'refine.md'), promptFile(p.system, p.user, rel(join(d, 'proposal.schema.json'))));
  console.log(`Active prompt v${p.activeVersionId}. Train: ${p.train.join(' ')}. Holdout (never shown to the refiner): ${p.holdout.join(' ') || 'none'}.`);
  if (p.missing.length) {
    console.log(`! Review these train games under v${p.activeVersionId} first, then run refine-prompt again: ${p.missing.join(' ')}`);
  } else {
    console.log(`✓ read ${rel(join(d, 'refine.md'))}, write ${rel(join(d, 'proposal.json'))}`);
  }
}

async function submitVersion() {
  const proposal = readJson(join(WORK, '_refine', 'proposal.json'));
  const v = await api<{ id: number; changelog: string }>('/evaluator/versions', { method: 'POST', body: { proposal } });
  console.log(`✓ Candidate prompt v${v.id} created. ${v.changelog}`);
  console.log(`Next: npm run evaluator -- calibration --version ${v.id}`);
}

async function calibration() {
  const c = await api<{
    versionId: number;
    activeId: number;
    games: { id: string; split: string }[];
    todo: { games: string[]; anchors: { id: string }[] };
    activeTodo: { games: string[]; anchors: { id: string }[] };
  }>(`/evaluator/calibration${values.version ? `?version=${values.version}` : ''}`);
  const list = (t: { games: string[]; anchors: { id: string }[] }) => [...t.games, ...t.anchors.map((a) => a.id)];
  console.log(`Calibration set: ${c.games.map((g) => `${g.id}${g.split === 'holdout' ? '*' : ''}`).join(' ')}   (* = holdout)`);
  console.log(`To review under v${c.versionId} (use --version ${c.versionId} --pool train): ${list(c.todo).join(' ') || 'nothing, all done'}`);
  if (c.versionId !== c.activeId) {
    console.log(`To review under active v${c.activeId} (use --version ${c.activeId} --pool train): ${list(c.activeTodo).join(' ') || 'nothing, all done'}`);
  }
  console.log(`When both are done: npm run evaluator -- score ${c.versionId}`);
}

async function score() {
  const id = Number(ids[0]);
  if (!id) fail('Usage: npm run evaluator -- score <version>');
  type M = { holdout?: { games: number; spearman: number | null; mae: number | null }; spearman: number | null; mae: number | null; humanGames: number; anchorsPassed: number; anchorsTotal: number; anchorFailures: string[] };
  const r = await api<{ versionId: number; metrics: M; activeId: number; activeMetrics: M }>(`/evaluator/versions/${id}/score`, { method: 'POST' });
  const f = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2));
  const row = (label: string, m: M) =>
    `${label.padEnd(12)} holdout ρ ${f(m.holdout?.spearman)} (n=${m.holdout?.games ?? 0}), gap ${f(m.holdout?.mae)}   all ρ ${f(m.spearman)} (n=${m.humanGames}), gap ${f(m.mae)}   anchors ${m.anchorsPassed}/${m.anchorsTotal}`;
  console.log(row(`active v${r.activeId}`, r.activeMetrics));
  if (r.versionId !== r.activeId) console.log(row(`candidate v${r.versionId}`, r.metrics));
  for (const a of r.metrics.anchorFailures) console.log(`! ${a}`);
}

async function promote() {
  const id = Number(ids[0]);
  if (!id) fail('Usage: npm run evaluator -- promote <version>');
  await api(`/evaluator/versions/${id}/promote`, { method: 'POST' });
  console.log(`✓ v${id} is now the active prompt.`);
}

async function seedVersion() {
  const changelog = ids.join(' ') || 'Rubric from apps/api/src/evaluator/rubric.ts.';
  const v = await api<{ id: number }>('/evaluator/versions', {
    method: 'POST',
    body: { version: { criteria: DEFAULT_CRITERIA, guidance: DEFAULT_GUIDANCE, changelog } },
  });
  console.log(`✓ Candidate prompt v${v.id} created from rubric.ts. Promote it with: npm run evaluator -- promote ${v.id}`);
}

async function results() {
  const summaries = await api<Record<string, EvaluationSummary>>('/evaluations');
  const local = new Map(
    gameIds().map((id) => {
      const manifest = readFileSync(join(GAMES_DIR, id, 'src', 'manifest.ts'), 'utf8');
      return [id, { name: /name: ['"]([^'"]+)/.exec(manifest)?.[1] ?? id, classic: /collection: ['"]classics/.test(manifest) }] as const;
    }),
  );
  const rows = Object.entries(summaries)
    .map(([id, s]) => ({ id, ...s, name: local.get(id)?.name ?? id, classic: local.get(id)?.classic ?? false }))
    .sort((a, b) => b.overall - a.overall);
  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const head = ['#', 'game', 'kind', 'overall', 'rec', ...FACETS.map((f) => f.label.split(' ')[0].slice(0, 6))];
  console.log(head.join('\t'));
  rows.forEach((r, i) =>
    console.log([i + 1, r.name, r.classic ? 'classic' : 'proto', r.overall.toFixed(2), r.recommendation, ...FACETS.map((f) => r.facets?.[f.key] ?? '-')].join('\t')),
  );
  const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '—');
  console.log(`\n${rows.length} reviewed. Mean overall: classics ${mean(rows.filter((r) => r.classic).map((r) => r.overall))}, prototypes ${mean(rows.filter((r) => !r.classic).map((r) => r.overall))}.`);
}

/** The keep gate every game must pass, for /iterate-game and /generate-games. */
const GATE = { overall: 3.5, clarity: 3 } as const;

type Reviewed = { overall: number; criteria: { key: string; score: number; reasoning?: string }[]; duplicateOf: string; cons: string[]; pros?: string[]; verdict?: string; versionId: number };

/** Why the AI review fails the keep gate; empty when it passes. */
function aiReasons(e: Reviewed): string[] {
  const score = (k: string) => e.criteria.find((c) => c.key === k)?.score ?? 0;
  return [
    ...(e.overall < GATE.overall ? [`overall ${e.overall.toFixed(2)} < ${GATE.overall}`] : []),
    ...['win_clarity', 'simplicity', 'odds_legibility'].filter((k) => score(k) < GATE.clarity).map((k) => `${k} ${score(k)} < ${GATE.clarity}`),
    ...(e.duplicateOf ? [`reskin of ${e.duplicateOf}`] : []),
    ...e.cons.filter((c) => c.startsWith('Dead structure')).map((c) => c.slice(0, c.indexOf(':'))),
  ];
}

/**
 * The keep gate. Where the team has rated this exact game, its rating decides
 * (team average, Pierre weighted, ≥ 3.5) and the AI review is only advice;
 * otherwise the AI review must pass.
 */
async function gateResult(id: string, e: Reviewed) {
  const team = (await local()).teamAverage.get(id);
  const ai = aiReasons(e);
  if (team == null) return { pass: !ai.length, reasons: ai, team };
  return { pass: team >= GATE.overall, reasons: team >= GATE.overall ? [] : [`team-rated ${team.toFixed(2)} < ${GATE.overall}`], team, ai };
}

/** The game's AI review: the stored one when the API answers, else its local review files scored locally. */
async function latestReview(id: string): Promise<Reviewed | null> {
  if (await online()) return api<Reviewed | null>(`/evaluations/${id}`);
  return existsSync(join(WORK, id, 'review.json')) ? ((await scoreLocal(id)) as Reviewed) : null;
}

const gateLine = (r: { id: string; pass: boolean; overall: number | null; reasons: string[]; team?: number; ai?: string[] }) =>
  `${r.pass ? 'PASS' : 'FAIL'} ${r.id}${r.overall == null ? '' : ` ${r.overall.toFixed(2)}`}${r.team == null ? '' : ` (team ${r.team.toFixed(2)} decides; AI: ${r.ai?.length ? r.ai.join('; ') : 'pass'})`}${r.reasons.length ? `: ${r.reasons.join('; ')}` : ''}`;

async function gate() {
  const targets = !values.all
    ? requireIds()
    : (await online())
      ? Object.keys(await api<Record<string, EvaluationSummary>>('/evaluations'))
      : gameIds().filter((id) => existsSync(join(WORK, id, 'review.json')));
  const rows = [];
  for (const id of targets) {
    const e = await latestReview(id);
    if (!e) {
      rows.push({ id, pass: false, overall: null, reasons: ['no review'] });
      continue;
    }
    rows.push({ id, overall: e.overall, version: e.versionId, ...(await gateResult(id, e)) });
  }
  if (values.json) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(gateLine(r));
  if (rows.some((r) => !r.pass)) process.exitCode = 1;
}

/**
 * Scores a game's local review files (review.json + the merged player panel)
 * with the same code the API uses, without storing anything, and checks the
 * gate. /iterate-game uses it to accept or revert a change before submitting.
 */
async function preview() {
  const rows = [];
  for (const id of requireIds()) {
    const saved = await scoreLocal(id);
    const gate = await gateResult(id, saved as Reviewed);
    write(join(dir(id), 'preview.json'), { ...saved, gate });
    rows.push({ id, overall: saved.overall, ...gate, facets: Object.fromEntries(saved.criteria.map((c) => [c.key, c.score])) });
  }
  if (values.json) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${gateLine(r)} (preview, not stored)`);
}

/** A game's latest stored review, plus the team's reviews: what /iterate-game works from. */
async function review() {
  for (const id of requireIds()) {
    const e = await latestReview(id);
    const reviews = (await local()).team.filter((r) => r.gameId === id);
    console.log(`# ${id}`);
    if (!e) console.log('No AI review yet.');
    else {
      console.log(`Overall ${e.overall.toFixed(2)}${(await online()) ? ` under v${e.versionId}` : ' (local review files, scored offline)'}. ${e.verdict ?? ''}`);
      console.log(`Gate: ${gateLine({ id, overall: e.overall, ...(await gateResult(id, e)) })}`);
      for (const c of e.criteria) console.log(`- ${c.key} ${c.score}: ${c.reasoning ?? ''}`);
      console.log(`Pros:\n${(e.pros ?? []).map((p) => `- ${p}`).join('\n')}`);
      console.log(`Cons:\n${e.cons.map((c) => `- ${c}`).join('\n')}`);
    }
    console.log(reviews.length ? `Team reviews:\n${reviews.map((r) => `- ${r.reviewer || 'anon'} ${r.stars}★ ${JSON.stringify(r.facets ?? {})} ${r.comment ?? ''}`).join('\n')}` : 'No team reviews.');
    console.log('');
  }
}

const commands: Record<string, () => Promise<void>> = {
  todo,
  prepare,
  'player-prompt': playerPrompt,
  play,
  'judge-prompt': judgePrompt,
  submit,
  'refine-prompt': refinePrompt,
  'submit-version': submitVersion,
  calibration,
  score,
  promote,
  'seed-version': seedVersion,
  results,
  gate,
  preview,
  review,
};

if (!command || !commands[command]) {
  const source = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  console.log(source.slice(0, source.findIndex((l) => l.startsWith('import'))).join('\n'));
  process.exit(command ? 1 : 0);
}
await commands[command]();
