import { spawn } from 'node:child_process';

/**
 * Another AI provider, described the way you would describe a colleague: what it is good at, how to reach it,
 * and how to tell when it has run out of hours.
 *
 * Each one is its own vendor CLI signed in with its own subscription. Nothing is proxied and no credential is
 * read: `codex` and `claude` each hold their own login.
 */
export interface Colleague {
  id: string;
  label: string;
  /** What the delegating model should send this one, in its own words. */
  goodAt: string;
  command: string;
  args(task: string, opts: { cwd: string; model?: string; write?: boolean }): string[];
  /** Pull the answer out of whatever the CLI printed. */
  answer(stdout: string): string;
  /** Is this "I am out of quota" rather than "the task failed"? */
  spent(stdout: string, code: number | null): boolean;
}

const LIMIT = /rate.?limit|usage limit|quota|too many requests|429|limit reached|requires usage credits|try again (later|in)|resets? (at|in)/i;

function jsonLines(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try { out.push(JSON.parse(s)); } catch { /* partial line */ }
  }
  return out;
}

export const CODEX: Colleague = {
  id: 'codex',
  label: 'Codex (OpenAI, via the ChatGPT subscription)',
  goodAt: 'reading a lot of code carefully, adversarial review, spotting edge cases and unhandled failure modes',
  command: 'codex',
  args: (task, o) => ['exec', '--json', '--sandbox', o.write ? 'workspace-write' : 'read-only',
                      '--skip-git-repo-check', ...(o.model ? ['-m', o.model] : []), task],
  answer(out) {
    const parts: string[] = [];
    for (const e of jsonLines(out)) {
      const o = e as { type?: string; item?: { type?: string; text?: string } };
      if (o.type === 'item.completed' && o.item?.type === 'agent_message' && o.item.text) parts.push(o.item.text);
    }
    return parts.join('\n').trim() || out.trim();
  },
  spent: (out, code) => code !== 0 && LIMIT.test(out)
};

export const COLLEAGUES: Record<string, Colleague> = { codex: CODEX };

export interface RunResult { ok: boolean; answer: string; spent: boolean; durationMs: number; }

export function run(c: Colleague, task: string, opts: { cwd: string; model?: string; write?: boolean; timeoutMs?: number }): Promise<RunResult> {
  const started = Date.now();
  return new Promise(resolve => {
    let done = false;
    const finish = (r: Omit<RunResult, 'durationMs'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...r, durationMs: Date.now() - started });
    };
    // stdin closed: without it the CLIs wait for piped input and never read the prompt in argv
    const child = spawn(c.command, c.args(task, { cwd: opts.cwd, model: opts.model, write: opts.write }),
                        { cwd: opts.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: string[] = [];
    child.stdout.on('data', d => out.push(d.toString()));
    child.stderr.on('data', d => out.push(d.toString()));
    const timer = setTimeout(() => { child.kill('SIGTERM');
      finish({ ok: false, spent: false, answer: `${c.id} did not answer within ${(opts.timeoutMs ?? 0) / 1000}s.` }); },
      opts.timeoutMs ?? 600000);
    child.once('error', e => finish({ ok: false, spent: false, answer: `${c.id} could not be started: ${e.message}` }));
    child.once('close', code => {
      const text = out.join('');
      const spent = c.spent(text, code);
      finish({ ok: code === 0, spent, answer: spent ? `${c.id} is out of usage for now. ${c.answer(text)}` : c.answer(text) });
    });
  });
}
