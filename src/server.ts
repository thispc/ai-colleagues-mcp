#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { COLLEAGUES, run } from './colleagues.js';
import { readQuota, gearFor, describe as describeQuota, DEFAULT_THRESHOLDS } from './quota.js';

/**
 * Other AI providers, registered as tools.
 *
 * Pulkit, 20 Sep 2026: Claude burns its window doing everything itself. This lets it hand the heavy reading
 * and the second opinions to a colleague on a different subscription, and spend its own budget on deciding
 * what to ask and what to do with the answer.
 *
 * The saving is real but specific: the delegating model never reads the files, only the summary that comes
 * back. It still pays for the question and the answer.
 */
const DEFAULT_TIMEOUT = 600_000;
const cwdOf = (p?: string) => p && p.trim() ? p : process.cwd();

const server = new McpServer({ name: 'ai-colleagues', version: '0.1.0' });

server.registerTool('list_colleagues', {
  title: 'List the AI colleagues available',
  description: 'Which other providers can be delegated to, what each is good at, and whether it is signed in. '
    + 'Call this first if you are unsure who to hand something to.',
  inputSchema: {}
}, async () => {
  const lines = await Promise.all(Object.values(COLLEAGUES).map(async c => {
    const probe = await run(c, 'Reply with the single word: ready',
      { cwd: process.cwd(), timeoutMs: 60_000 });
    const state = probe.spent ? 'out of usage' : probe.ok ? 'available' : 'not reachable';
    return `- ${c.id}: ${c.label}\n  good at: ${c.goodAt}\n  state: ${state}`;
  }));
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

server.registerTool('my_quota', {
  title: "How much of my own window is left",
  description:
    'How much of Claude\'s usage window remains, read from its own cache, and what that suggests. Call it when '
    + 'a session has run long or a job looks bulky, and let the answer decide: with plenty left, do the work '
    + 'yourself; near the floor, hand it to a colleague with `delegate` and keep the rest for judgement. '
    + 'Thresholds default to 70 and 30 percent remaining.',
  inputSchema: {
    best_above_percent: z.number().optional(),
    saver_below_percent: z.number().optional()
  }
}, async ({ best_above_percent, saver_below_percent }) => {
  const t = { ...DEFAULT_THRESHOLDS,
              bestAbove: best_above_percent ?? DEFAULT_THRESHOLDS.bestAbove,
              saverBelow: saver_below_percent ?? DEFAULT_THRESHOLDS.saverBelow };
  const q = readQuota();
  const gear = gearFor(q, t);
  const advice = gear === 'saver'
    ? 'Delegate the bulky parts now; keep what is left for deciding and writing.'
    : gear === 'plenty' ? 'Plenty left: do it yourself.'
    : 'Middling: delegate work that is bulky rather than hard.';
  return { content: [{ type: 'text', text: `${describeQuota(q, t)}\n${advice}` }] };
});

server.registerTool('delegate', {
  title: 'Hand a piece of work to another AI',
  description:
    'Give a self-contained task to a colleague on a different subscription and get its answer back. '
    + 'Use this for work that would cost you a lot of context to do yourself: reading many files, trawling a '
    + 'large log, drafting something long, or checking a body of code for a specific class of problem. '
    + 'The colleague runs in this repository and can open files itself, so name paths rather than pasting '
    + 'contents. Write the task as you would to a competent engineer who has not seen the conversation: say '
    + 'what to look at, what to decide, and what shape the answer should take.',
  inputSchema: {
    task: z.string().describe('The complete instruction, standing alone. Name files and paths to read.'),
    colleague: z.string().optional().describe('Who to ask (default: codex).'),
    cwd: z.string().optional().describe('Directory to work in (default: the current one).'),
    model: z.string().optional().describe('Model override for that provider.'),
    write: z.boolean().optional().describe('Allow it to change files. Off by default; ask before turning on.'),
    timeout_seconds: z.number().optional()
  }
}, async ({ task, colleague, cwd, model, write, timeout_seconds }) => {
  const c = COLLEAGUES[(colleague ?? 'codex').toLowerCase()];
  if (!c) {
    return { isError: true, content: [{ type: 'text', text: `No colleague called "${colleague}". Known: ${Object.keys(COLLEAGUES).join(', ')}.` }] };
  }
  const r = await run(c, task, { cwd: cwdOf(cwd), model, write, timeoutMs: (timeout_seconds ?? 600) * 1000 });
  const head = r.spent ? `[${c.id} is out of usage; do this one yourself]`
             : r.ok ? `[${c.id}, ${Math.round(r.durationMs / 1000)}s]`
             : `[${c.id} failed]`;
  return { isError: !r.ok && !r.spent, content: [{ type: 'text', text: `${head}\n\n${r.answer}` }] };
});

server.registerTool('second_opinion', {
  title: 'Have a colleague review something you wrote',
  description:
    'Send your own answer, plan or patch to a colleague and get it criticised. Use it before anything '
    + 'expensive to get wrong: an architecture decision, a risky change, a claim going to an employer. '
    + 'It returns the critique only, so you decide what to accept.',
  inputSchema: {
    question: z.string().describe('What was being decided.'),
    answer: z.string().describe('Your answer, plan or patch, in full.'),
    colleague: z.string().optional(),
    cwd: z.string().optional(),
    focus: z.string().optional().describe('What to weigh most, e.g. "correctness", "security", "is this honest".')
  }
}, async ({ question, answer, colleague, cwd, focus }) => {
  const c = COLLEAGUES[(colleague ?? 'codex').toLowerCase()];
  if (!c) return { isError: true, content: [{ type: 'text', text: `No colleague called "${colleague}".` }] };
  const task =
    `A colleague was asked this:\n\n${question}\n\nThey answered:\n\n${answer}\n\n`
    + `Review it${focus ? `, weighing ${focus} above all` : ''}. Say where it is wrong, thin, or missing `
    + `something that matters, and name the strongest part. Be concrete and quote what you mean. `
    + `If it is sound, say so plainly rather than inventing faults. Under 250 words.`;
  const r = await run(c, task, { cwd: cwdOf(cwd), timeoutMs: 600_000 });
  const head = r.spent ? `[${c.id} is out of usage; no second opinion this time]` : `[${c.id} reviewing]`;
  return { content: [{ type: 'text', text: `${head}\n\n${r.answer}` }] };
});

await server.connect(new StdioServerTransport());
