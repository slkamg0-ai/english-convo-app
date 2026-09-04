import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('.flashcard-face is never grouped into a shared background rule', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

  // .flashcard-front/.flashcard-back each set their own background+text color for
  // contrast (light front, dark accent back with white text). A later shared rule
  // like ".card, ..., .flashcard-face { background: ... }" has equal specificity and
  // comes after those declarations in source order, so it silently overrides
  // .flashcard-back's background — leaving the white translation text invisible on a
  // near-white background. Any rule that sets `background` must not include
  // .flashcard-face in its selector list.
  const backgroundRules = [...css.matchAll(/([^{}]+)\{[^}]*background:[^}]*\}/g)].map(match => match[1]);
  const offendingRule = backgroundRules.find(selectorList => selectorList.includes('.flashcard-face'));
  assert.equal(offendingRule, undefined, `found a shared background rule including .flashcard-face: ${offendingRule}`);
});
