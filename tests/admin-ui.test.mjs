import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('admin claims renderer does not inject learner-controlled HTML', async () => {
  const source = await readFile(new URL('../admin-ui.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /learner\.textContent = claim\.displayName/);
  assert.match(source, /reward\.textContent = `\$\{claim\.rewardLabel/);
});

test('reward rules renderer does not inject server-provided HTML', async () => {
  const source = await readFile(new URL('../rewards-ui.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /label\.textContent = rule\.label/);
  assert.match(source, /description\.textContent = rule\.description/);
  assert.match(source, /badge\.textContent = tag\(rule\)/);
});
