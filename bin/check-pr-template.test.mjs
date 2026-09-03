import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const checkerPath = path.join(rootDirectory, 'bin', 'check-pr-template.mjs');
const templatePath = path.join(
  rootDirectory,
  '.github',
  'PULL_REQUEST_TEMPLATE.md'
);

const EXCLUSIVITY_ISSUE =
  '**Release Notes** must select exactly one of the two release-note options.';
const MISSING_OPTION_ISSUE =
  '**Release Notes** must select a release-note fragment or the internal-only opt-out.';

const FRAGMENT_OPTION =
  'I added a release-note fragment under `release-notes/`.';
const INTERNAL_ONLY_OPTION =
  'This change is internal-only and does not need a user-facing release note.';
const SCHEMA_CONFIRMATION =
  'The fragment includes audience, area, action, and breaking-change status.';
const PREVIEW_CONFIRMATION =
  'I previewed the release text with `pnpm release-notes:preview`.';

const box = (checked, text) => `- [${checked ? 'x' : ' '}] ${text}`;

const buildBody = (releaseNoteLines) =>
  [
    '## Description',
    '',
    'Scope the release-note exclusivity check to the two mutually exclusive options.',
    '',
    '## How Has This Been Tested?',
    '',
    'Ran `node --test bin/check-pr-template.test.mjs`.',
    '',
    '## Release Notes',
    '',
    ...releaseNoteLines,
    '',
    '## Checklist:',
    '',
    box(true, 'I have read and followed the contribution guidelines.'),
    box(true, 'Disclosed any use of AI'),
    '',
  ].join('\n');

const runCheck = (body, environment = {}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'seerr-pr-template-')
  );
  try {
    const bodyPath = path.join(directory, 'pr-body.txt');
    fs.writeFileSync(bodyPath, body, { mode: 0o600 });

    const result = spawnSync(process.execPath, [checkerPath, bodyPath], {
      cwd: rootDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTHOR_ASSOCIATION: 'CONTRIBUTOR',
        ...environment,
      },
    });

    return { status: result.status, issues: JSON.parse(result.stdout) };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test('a single release-note option satisfies the exclusive choice', () => {
  const fragment = runCheck(
    buildBody([
      box(true, FRAGMENT_OPTION),
      box(false, INTERNAL_ONLY_OPTION),
      box(false, SCHEMA_CONFIRMATION),
      box(false, PREVIEW_CONFIRMATION),
    ])
  );

  assert.deepEqual(fragment.issues, []);
  assert.equal(fragment.status, 0);

  const internalOnly = runCheck(
    buildBody([
      box(false, FRAGMENT_OPTION),
      box(true, INTERNAL_ONLY_OPTION),
      box(false, SCHEMA_CONFIRMATION),
      box(false, PREVIEW_CONFIRMATION),
    ])
  );

  assert.deepEqual(internalOnly.issues, []);
  assert.equal(internalOnly.status, 0);
});

test('checking both release-note options is rejected', () => {
  const { status, issues } = runCheck(
    buildBody([
      box(true, FRAGMENT_OPTION),
      box(true, INTERNAL_ONLY_OPTION),
      box(false, SCHEMA_CONFIRMATION),
      box(false, PREVIEW_CONFIRMATION),
    ])
  );

  assert.deepEqual(issues, [EXCLUSIVITY_ISSUE]);
  assert.equal(status, 1);
});

test('checking neither release-note option is rejected', () => {
  const { status, issues } = runCheck(
    buildBody([
      box(false, FRAGMENT_OPTION),
      box(false, INTERNAL_ONLY_OPTION),
      box(false, SCHEMA_CONFIRMATION),
      box(false, PREVIEW_CONFIRMATION),
    ])
  );

  assert.deepEqual(issues, [EXCLUSIVITY_ISSUE]);
  assert.equal(status, 1);
});

test('confirmations do not count towards the exclusive choice', () => {
  const { status, issues } = runCheck(
    buildBody([
      box(true, FRAGMENT_OPTION),
      box(false, INTERNAL_ONLY_OPTION),
      box(true, SCHEMA_CONFIRMATION),
      box(true, PREVIEW_CONFIRMATION),
    ])
  );

  assert.deepEqual(issues, []);
  assert.equal(status, 0);
});

test('confirmations alone do not stand in for a release-note option', () => {
  const { status, issues } = runCheck(
    buildBody([box(true, SCHEMA_CONFIRMATION), box(true, PREVIEW_CONFIRMATION)])
  );

  assert.deepEqual(issues, [MISSING_OPTION_ISSUE]);
  assert.equal(status, 1);
});

test('the checked-in template passes when filled out honestly', () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  const body = template
    .replace(
      '- Fixes #XXXX',
      '- Fixes #1234\n\nScope the release-note exclusivity check to the two options.'
    )
    .replace(
      '## Screenshots / Logs (if applicable)',
      'Ran `node --test bin/check-pr-template.test.mjs`.\n\n## Screenshots / Logs (if applicable)'
    )
    .split('\n')
    .map((line) =>
      line.startsWith('- [ ] ') && !/internal-only/iu.test(line)
        ? line.replace('- [ ] ', '- [x] ')
        : line
    )
    .join('\n');

  assert.match(body, /- \[x\] The fragment includes audience/u);
  assert.match(body, /- \[x\] I previewed the release text/u);

  const { status, issues } = runCheck(body);

  assert.deepEqual(issues, []);
  assert.equal(status, 0);
});
