import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function run(): void {
  const { values } = parseArgs({
    options: { input: { type: 'string', default: '/input' }, output: { type: 'string' } },
  });
  const input = values.input;
  const out = values.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  let snapshotFile = input;
  try {
    if (statSync(input).isDirectory()) snapshotFile = join(input, 'snapshot.json');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!input.endsWith('.json')) snapshotFile = join(input, 'snapshot.json');
  }

  const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`Invalid board: ${issue}`);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
  cpSync(join(root, 'dashboard'), join(out, 'dashboard'), { recursive: true });

  const sourceShots = join(root, 'screenshots');
  const outputShots = join(out, 'screenshots');
  mkdirSync(outputShots, { recursive: true });
  // Git omits empty directories, so a fresh Session 1 checkout may lack screenshots/.
  const shots = readdirSync(sourceShots, { withFileTypes: true, throwIfNoEntry: false }) ?? [];
  const visible = shots.filter(entry => !entry.name.startsWith('.'));
  for (const entry of visible) {
    if (!entry.isFile() || !/\.(?:png|jpe?g)$/i.test(entry.name)) {
      throw new Error(`screenshots/${entry.name} must be a regular PNG or JPEG file`);
    }
    cpSync(join(sourceShots, entry.name), join(outputShots, entry.name));
  }
  if (visible.length < 3) {
    throw new Error(`screenshots/ contains ${visible.length} images. At least 3 are required to build dossier.json.`);
  }

  const dossier = buildDossier(out, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(out, 'dossier.json'), dossier);
  process.stdout.write(`Wrote ${board.length} ranked rows, ${radar.live_size} live rows and the dossier to ${out}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`Token Radar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
