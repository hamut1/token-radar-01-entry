import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

function snapshotPath(input: string): string {
  try {
    return statSync(input).isDirectory() ? join(input, 'snapshot.json') : input;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return input.endsWith('.json') ? input : join(input, 'snapshot.json');
  }
}

function copyScreenshots(output: string): void {
  const source = join(root, 'screenshots');
  const destination = join(output, 'screenshots');
  mkdirSync(destination, { recursive: true });
  // Git omits empty directories, so a fresh checkout may lack screenshots/.
  const entries = readdirSync(source, { withFileTypes: true, throwIfNoEntry: false }) ?? [];
  const images = entries.filter(entry => !entry.name.startsWith('.'));
  for (const image of images) {
    if (!image.isFile() || !/\.(?:png|jpe?g)$/i.test(image.name)) {
      throw new Error('screenshots/' + image.name + ' must be a regular PNG or JPEG file');
    }
    cpSync(join(source, image.name), join(destination, image.name));
  }
  if (images.length < 3) {
    throw new Error('screenshots/ contains ' + images.length + ' images. At least 3 are required to build dossier.json.');
  }
}

function run(): void {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: '/input' },
      output: { type: 'string' },
    },
  });
  const output = values.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const snapshot = parseSnapshot(readFileSync(snapshotPath(values.input), 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error('Invalid board: ' + issue);

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  cpSync(join(root, 'dashboard'), join(output, 'dashboard'), { recursive: true });
  copyScreenshots(output);

  const dossier = buildDossier(output, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(output, 'dossier.json'), dossier);
  process.stdout.write('Wrote ' + board.length + ' ranked rows, ' + radar.live_size +
    ' live rows and the dossier to ' + output + '\n');
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('Token Radar: ' + message + '\n');
  process.exitCode = 1;
}
