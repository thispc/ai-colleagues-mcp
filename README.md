# ai-colleagues-mcp

Other AI providers, registered as tools, so Claude Code can delegate instead of doing everything itself.

Claude spends its window fastest on work that is bulky rather than hard: reading twenty files to answer one
question, trawling a log, checking a body of code for one class of mistake. This gives it a colleague on a
different subscription to hand that to, and keeps its own budget for deciding what to ask and what to do with
the answer.

## What it saves, honestly

The delegating model never reads the files, only the summary that comes back. It still pays for the question
it writes and the answer it reads. So the saving is large on bulk reading and small on short questions; asking
a colleague to answer a one-line question costs more than answering it.

## Tools

- `list_colleagues` — who is available, what each is good at, and whether it is signed in or out of usage.
- `delegate` — hand over a self-contained task. The colleague runs in the repository and opens files itself,
  so name paths rather than pasting contents. Read-only unless `write: true`.
- `second_opinion` — send your own answer, plan or patch and get it criticised. Returns the critique only.

## How the providers are reached

Each colleague is its own vendor CLI, signed in with its own subscription: `codex login` for OpenAI. Nothing
is proxied, no credential is read or copied, and no request pretends to come from software it did not.

## Install

```
npm install && npm run compile
claude mcp add ai-colleagues --scope user -- node "$PWD/dist/server.js"
```

Restart Claude Code so it picks the tools up. `claude mcp list` should show it connected.

## Adding a colleague

Add an entry to `COLLEAGUES` in `src/colleagues.ts`: how to build its arguments, how to read its answer out of
whatever it prints, and how to tell "out of quota" from "the task failed". The rest is shared.
