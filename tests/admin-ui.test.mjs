import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('admin claims renderer does not inject learner-controlled HTML', async () => {
  const source = await readFile(new URL('../admin-ui.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /learner\.textContent = claim\.displayName/);
  assert.match(source, /reward\.textContent = `\$\{claim\.rewardLabel/);
});

test('invite form submit handler does not read event.currentTarget after an await', async () => {
  const source = await readFile(new URL('../admin-ui.js', import.meta.url), 'utf8');

  // event.currentTarget is nulled out once the DOM event dispatch finishes, which
  // happens synchronously before an awaited promise resolves — reading it afterward
  // throws "Cannot read properties of null" instead of resetting the form.
  assert.doesNotMatch(source, /await[^;]*;\s*[\s\S]{0,80}event\.currentTarget/);
});

test('invite table never falls back to the invite id as if it were the plain code', async () => {
  const source = await readFile(new URL('../admin-ui.js', import.meta.url), 'utf8');

  // GET /api/admin/invites never returns the plain code (by design — it's shown once
  // at creation). Falling back to invite.id there renders a UUID that looks enough
  // like a code that an admin can copy-paste it to a learner, who then can't sign up.
  assert.doesNotMatch(source, /invite\.code \|\| invite\.id/);
});

test('reward rules renderer does not inject server-provided HTML', async () => {
  const source = await readFile(new URL('../rewards-ui.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /label\.textContent = rule\.label/);
  assert.match(source, /description\.textContent = rule\.description/);
  assert.match(source, /badge\.textContent = tag\(rule\)/);
});
