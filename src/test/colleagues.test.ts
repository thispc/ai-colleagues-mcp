import test from 'node:test';
import assert from 'node:assert/strict';
import { CODEX, run } from '../colleagues.js';

test('codex gets the prompt as an argument and stays read-only unless asked', () => {
  const args = CODEX.args('do a thing', { cwd: '.' });
  assert.deepEqual(args, ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', 'do a thing']);
  const writing = CODEX.args('edit a thing', { cwd: '.', write: true });
  assert.ok(writing.includes('workspace-write'), 'writing is opt-in');
  assert.ok(!args.includes('--'), 'the separator made codex wait on stdin instead of reading the prompt');
});

test('the answer is pulled out of the event stream', () => {
  const out = [
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"The bug is in parse()."}}',
    '{"type":"turn.completed","usage":{"input_tokens":10}}'
  ].join('\n');
  assert.equal(CODEX.answer(out), 'The bug is in parse().');
  assert.equal(CODEX.answer('not json at all'), 'not json at all', 'plain output still comes through');
});

test('being out of quota is told apart from failing', () => {
  assert.ok(CODEX.spent('usage limit reached', 1));
  assert.ok(CODEX.spent('429 Too Many Requests', 1));
  assert.ok(!CODEX.spent('SyntaxError: bad token', 1), 'a real failure is not a limit');
  assert.ok(!CODEX.spent('usage limit reached', 0), 'a run that worked is never spent');
});

test('a colleague that cannot be started is reported, not thrown', async () => {
  const missing = { ...CODEX, id: 'ghost', command: 'definitely-not-a-real-binary-xyz' };
  const r = await run(missing, 'hello', { cwd: process.cwd(), timeoutMs: 5000 });
  assert.equal(r.ok, false);
  assert.equal(r.spent, false);
  assert.match(r.answer, /could not be started/);
});

test('a colleague that hangs is killed and says so', async () => {
  const slow = { ...CODEX, id: 'slow', command: 'sleep', args: () => ['30'] };
  const r = await run(slow, 'hello', { cwd: process.cwd(), timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.answer, /did not answer within/);
});
