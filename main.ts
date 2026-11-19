// Token Radar's program: one sealed snapshot in, one ranked board and dashboard out.
//
//   node main.ts --input <snapshot.json or a directory holding it>
//
// Reads the snapshot, scores every protocol with the impliedValueV2 model, and writes to
// MAKEFUN_OUTPUT_DIR (default /output):
//
//   board.json      { rows: [...] } — the ranked board, watchlist covered, farm plans included
//   data.js         window.RADAR — everything the dashboard renders, no fetch and no network
//   dashboard/      the static dashboard, copied as-is
//   screenshots/    the three dashboard screenshots, copied as-is
//   dossier.json    the canonical dossier of dashboard/ + screenshots/, via vendor/makefun-board.ts
//
// Deterministic: no clock, no randomness, no unordered iteration. Run it twice and the outputs
// are byte-identical. Exits 1 when the board fails its own gate or the dossier cannot be built.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

const DOSSIER_CAPS = {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
};

function usage(): string {
  return [
    'usage: node main.ts [--input <snapshot.json or directory>]',
    '',
    '  --input   the sealed snapshot, or a directory holding snapshot.json (default /input)',
    '  --help    this text',
    '',
    'Writes board.json, data.js, dashboard/, screenshots/ and dossier.json to',
    'MAKEFUN_OUTPUT_DIR (default /output).',
  ].join('\n');
}

function fail(message: string): never {
  console.error(`main.ts: ${message}`);
  process.exit(1);
}

/** The snapshot file: --input itself, or snapshot.json inside --input. */
function snapshotPath(input: string): string {
  const resolved = resolve(input);
  if (!existsSync(resolved)) fail(`no such input: ${input}`);
  if (statSync(resolved).isDirectory()) {
    const inside = join(resolved, 'snapshot.json');
    if (!existsSync(inside)) fail(`no snapshot.json in ${input}`);
    return inside;
  }
  return resolved;
}

function main(argv: string[]): void {
  let input = '/input';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      return;
    }
    if (arg === '--input') {
      const value = argv[i + 1];
      if (value === undefined) fail('--input needs a value');
      input = value;
      i++;
      continue;
    }
    fail(`unknown argument: ${arg} (see --help)`);
  }

  const snapshot = parseSnapshot(readFileSync(snapshotPath(input), 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(`the board fails its gate: ${issue}`);

  const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  mkdirSync(out, { recursive: true });

  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`, 'utf8');
  writeFileSync(join(out, 'data.js'), dataScript(radar), 'utf8');

  const dashboardSrc = join(ROOT, 'dashboard');
  const shotsSrc = join(ROOT, 'screenshots');
  if (!existsSync(dashboardSrc)) fail('no dashboard/ directory beside main.ts');
  if (!existsSync(shotsSrc)) fail('no screenshots/ directory beside main.ts');
  cpSync(dashboardSrc, join(out, 'dashboard'), { recursive: true });
  cpSync(shotsSrc, join(out, 'screenshots'), { recursive: true });

  const dossier = buildDossier(out, DOSSIER_CAPS);
  writeFileSync(join(out, 'dossier.json'), dossier);

  const shotCount = readdirSync(shotsSrc).filter((name) => !name.startsWith('.')).length;
  console.log(
    [
      `board: ${board.length} rows (${radar.watchlist_size} watchlist, ${radar.early_size} early, ${radar.flagged_size} flagged)`,
      `top: ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}`,
      `live set aside: ${radar.live_size} protocols`,
      `screenshots: ${shotCount}`,
      `dossier: ${dossier.length} bytes`,
      `wrote ${out}`,
    ].join('\n'),
  );
}

main(process.argv.slice(2));
