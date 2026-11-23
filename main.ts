import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Resolve bundled assets relative to this module so the CLI can run from another directory.
// The caller supplies the snapshot and chooses where to assemble the output bundle.
const root = fileURLToPath(new URL('.', import.meta.url));

// Accept either a JSON file or a directory containing the conventional snapshot filename.
// For a missing path, use its extension to choose the filename that the read will report.
// Propagate other filesystem errors so callers can diagnose permissions and access issues.
function snapshotPath(input: string): string {
  try {
    return statSync(input).isDirectory() ? join(input, 'snapshot.json') : input;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return input.endsWith('.json') ? input : join(input, 'snapshot.json');
  }
}

// The dossier uses the already bundled screenshots as evidence of dashboard views.
// The accepted inputs are regular PNG and JPEG files in the asset directory.
// Hidden entries are ignored so checkout housekeeping files stay out of the bundle.
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

// A run produces the evaluator board, an offline dashboard bundle, and its dossier.
// Use a fresh destination when comparing runs because dossier assembly reads staged files.
function run(): void {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: '/input' },
      output: { type: 'string' },
    },
  });
  // An explicit flag takes precedence over the environment and the container default.
  const output = values.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  // Parsing fixes the input schema before the model uses any of the snapshot fields.
  // Scoring uses the snapshot's date and stable tie breakers, so execution time cannot affect ranks.
  const snapshot = parseSnapshot(readFileSync(snapshotPath(values.input), 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  // Check board invariants before creating artifacts for downstream consumers.
  if (issue !== null) throw new Error('Invalid board: ' + issue);

  // Both serializations come from this run's single model result.
  // The browser reads data.js as a script, which also works when the page opens from disk.
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  cpSync(join(root, 'dashboard'), join(output, 'dashboard'), { recursive: true });
  copyScreenshots(output);

  // Assemble the dossier after writing the data and staging the assets it draws from.
  // Pass the packaging limits to the kit builder, which supplies the serialized dossier.
  // The screenshot and dashboard settings bound file counts and packaged bytes.
  const dossier = buildDossier(output, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  // The success message follows the final write so consumers can wait for a complete bundle.
  // Its destination path is for the caller and stays outside the generated artifacts.
  writeFileSync(join(output, 'dossier.json'), dossier);
  process.stdout.write('Wrote ' + board.length + ' ranked rows, ' + radar.live_size +
    ' live rows and the dossier to ' + output + '\n');
}

// Surface input, validation, and output errors through a common CLI diagnostic.
// A nonzero status also lets scripted callers detect failures without parsing the message.
try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write('Token Radar: ' + message + '\n');
  process.exitCode = 1;
}
