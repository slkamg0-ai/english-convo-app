import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generated learner answer inputs have accessible names', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(index, /id="text-answer-input"[^>]+aria-label="상황극 영어 답변 입력"/);
  assert.match(app, /input\.setAttribute\("aria-label", "커리큘럼 영어 답변 입력"\)/);
  assert.match(app, /input\.placeholder = "영어로 답해보세요"/);
});