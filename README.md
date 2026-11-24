# mark

A personal assistant for one person, living in Slack. Built on
[Mastra][mastra], forked from [gorkie][gorkie] by techwithanirudh.

mark takes chores off the owner's plate: a daily engineering and news briefing,
their schedule and meetings, and more over time. It runs in a Slack workspace
under one bot identity and never posts as the owner.

## Status

mark is mid-conversion from gorkie. Today the code still has gorkie's
feature set, listed under [What works today](#what-works-today). The mark
design is written down and not yet built. Read it in
[docs/superpowers/specs/2026-11-24-mark-design.md](./docs/superpowers/specs/2026-11-24-mark-design.md).

## What mark is meant to be

- **One Slack app, two agents, routed by sender.** Only the owner (matched by
  Slack user ID) reaches **mark**, the privileged agent. Anyone else who pings
  the app reaches the **receptionist**, which can take a message, show
  free/busy to allowlisted people, and ask the owner, and nothing else. Everything a non-owner says
  is treated as data, never as instructions.
- **Owns the schedule.** No external calendar. Events live in Postgres, with
  `.ics` import and export.
- **Daily briefing.** An engineering radar across the owner's GitHub orgs
  (PRs awaiting review, CI failures, stale PRs) plus news tuned to the owner's
  interests.
- **Approval by DM card.** Meeting requests from other people, new skills,
  and new subagents all wait for the owner to tap Approve.
- **Learns and extends itself.** It remembers preferences, writes its own
  skills, defines subagents, and connects to MCP servers when the owner
  supplies the details. It can open pull requests against its own code. It
  never merges them. Branch protection on `main` requires an approving
  review.

## What works today

This is inherited from gorkie and works as it did there.

- Slack-native replies for mentions, DMs, and subscribed thread follow-ups,
  streamed as they generate, with a typing indicator.
- Optional opt-in allowlist (`OPT_IN_CHANNEL`): gate access to members of one
  channel, with an in-Slack opt-in card for everyone else.
- Per-thread [E2B][e2b] sandbox sessions: isolated cloud VMs, never the host.
  Full filesystem access (`read_file`/`write_file`/`edit_file`/`list_files`/
  `delete_file`/`file_stat`) plus shell command execution
  (`execute_command`) with background process support (`get_process_output`,
  `kill_process`).
- Delegated helper agents for research (Slack and web lookups) and codebase
  exploration (read-only workspace inspection).
- Web search and page fetching via [Exa][exa], plus a Slack "code mode" tool
  for query-driven or exhaustive conversation analysis.
- Slack-native tools: read and summarize conversation history, list threads
  and channels, inspect channels and users, post to another
  thread/channel/DM, upload and download files, react, leave a thread. It
  reads only the current conversation and public channels, and DMs only the
  person who asked.
- Slack Canvas tools: create, list, read, edit, and look up sections.
- Recurring scheduled tasks (cron-based, create/list/pause/resume/delete).
  Each run posts back into the conversation where it was scheduled.
- GitHub tools and user-connected MCP servers.
- AI image generation, uploaded back into the Slack thread as a file.
- Most tools load on demand through tool search, so the base tool list and the
  prompt stay small.
- [Observational Memory][om] compresses a long conversation into an
  observation log instead of carrying the full raw history.
- Mastra Observability tracing, stored locally in DuckDB.

See [TODO.md](./TODO.md) for open work and known issues.

## Tech stack

- [Bun][bun] and TypeScript
- [Mastra][mastra], agent runtime + [channels][channels]
- [Vercel Chat SDK][chat-sdk] with `@chat-adapter/slack` (via Mastra channels)
- Model routing through the [Vercel AI Gateway][ai-gateway] `vmc/gorkie` config,
  falling back to the [Hack Club][hackclub] proxy when the gateway fails
- [E2B][e2b] sandbox sessions
- [Exa][exa] for web search and page fetching
- [PostgreSQL][postgres] via `@mastra/pg`
- Mastra Observability, exported to local [DuckDB][duckdb]

## Getting started

Create a new [Slack app](https://api.slack.com/apps) from a manifest using
[`slack-manifest.json`](./slack-manifest.json), which turns on Socket Mode,
the App Home, scopes, and event subscriptions. You also need [Bun][bun], a
[PostgreSQL][postgres] database, an [E2B][e2b] API key, an [Exa][exa] API key,
and model keys for both [Vercel AI Gateway][ai-gateway] and [Hack Club][hackclub].

```bash
# Clone this repository
git clone https://github.com/sectersion/mark.git

# Install dependencies
bun install

# Copy and fill in the environment
cp .env.example .env

# Build the configured E2B sandbox image
bun run build:template

# Run the bot locally (also serves Mastra Studio at http://localhost:4111)
bun run dev
```

Local development uses Slack Socket Mode, so the bot needs no public HTTP
tunnel to receive Slack events. It logs `[gorkie] online` once connected (the
log line has not been renamed yet).

Do not run two local instances against the same Slack app token. Their Socket
Mode connections race, and the resulting behavior is hard to diagnose.

For a production-style run: `bun run build` then `bun run start`.

### Local Postgres database

The default `DATABASE_URL` in [`.env.example`](./.env.example) points at a
local database named `gorkie`. Mastra creates its tables on first run.

## Environment

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | yes | Bot User OAuth token (`xoxb-…`) |
| `SLACK_APP_TOKEN` | yes | App-level token with `connections:write` (`xapp-…`) |
| `SLACK_USER_TOKEN` | yes | Slack user token, not the bot token, used for public-channel search. Mint it with `search:read.public` only; the code verifies the granted scopes on first use and refuses the token if it also carries `search:read.im`, `search:read.mpim`, or `search:read.private`. See [docs/slack-search.md](docs/slack-search.md) |
| `OPT_IN_CHANNEL` | no | Slack channel id gating access to members only (opt-in allowlist); unset means everyone is allowed |
| `AI_GATEWAY_API_KEY` | yes | Vercel AI Gateway key, used for the `vmc/gorkie` model config |
| `HACKCLUB_API_KEY` | yes | Hack Club AI proxy key, the fallback and the image model |
| `DATABASE_URL` | yes | Postgres connection string |
| `LANGFUSE_PUBLIC_KEY` | yes | Langfuse public key. Tracing is the only production exporter, so the agent refuses to start without it |
| `LANGFUSE_SECRET_KEY` | yes | Langfuse secret key |
| `LANGFUSE_BASE_URL` | no | Self-hosted Langfuse only; defaults to `https://cloud.langfuse.com` |
| `E2B_API_KEY` | yes | E2B sandbox key (`e2b_…`) |
| `CREDENTIALS_KEY` | yes | Encrypts connected GitHub and MCP tokens at rest (`openssl rand -base64 32`) |
| `GITHUB_APP_SLUG` | yes | The app's URL slug, used to link people to the install page |
| `GITHUB_APP_CLIENT_ID` | yes | GitHub App client id, for the App Home sign-in (see [docs/github-app.md](./docs/github-app.md)) |
| `GITHUB_APP_CLIENT_SECRET` | yes | GitHub App client secret, used to refresh expiring user tokens |
| `EXA_API_KEY` | yes | Exa key, powers `search_web`/`fetch_url` |
| `AGENTMAIL_API_KEY` | no | Lets the sandbox reach the AgentMail API without the key entering the sandbox |

See [`.env.example`](./.env.example) for the full annotated list. The design
adds an `OWNER_SLACK_USER_ID` variable; it does not exist yet.

## Project structure

```text
src/
  env.ts                        Zod-validated environment
  mastra/
    index.ts                    Mastra instance: Postgres, Observability, logger, agents
    config.ts                   Sandbox and agent config
    providers.ts                Model gateway definitions (orchestrator, summarizer, scout, explorer, images)
    agents/orchestrator.ts      The agent: model, instructions, memory, tools, channels
    agents/research.ts          Delegated Slack/web research helper agent
    agents/explore.ts           Delegated read-only codebase exploration helper agent
    chat/                       Chat SDK client, handlers, typing status
    workspace/                  E2B sandbox workspace (per-thread, isolated)
    tools/                      Tool registry: Slack, canvas, scheduled tasks, sandbox, web, code mode
    processors/                 Input/output processors (delegated tools, sandbox, tool media)
    prompts/                    System prompt sections (core, personality, Slack, tools)
    mcp/                        MCPClient scaffold for connecting external MCP servers
workspace/skills/               Runtime skills, as SKILL.md folders
docs/                           Setup notes and the mark design
```

Constructing the Mastra instance registers the agent, which opens the Slack
Socket Mode connection.

## Development

```bash
bun run dev             # Mastra Studio and the Slack bot
bun run build           # Production build
bun run start           # Run the production build
bun run build:template  # Build the configured E2B image
bun run typecheck
bun run check           # Biome/ultracite
bun run check:spelling
```

`main` is protected: changes land through a pull request with one approving
review, and force pushes and branch deletion are blocked.

## License

[AGPL-3.0](./LICENSE). Forked from [gorkie][gorkie].

[gorkie]: https://github.com/techwithanirudh/gorkie
[mastra]: https://mastra.ai
[channels]: https://mastra.ai/docs/channels/overview
[chat-sdk]: https://github.com/vercel/chat-sdk
[e2b]: https://e2b.dev
[exa]: https://exa.ai
[hackclub]: https://ai.hackclub.com
[ai-gateway]: https://vercel.com/docs/ai-gateway
[postgres]: https://www.postgresql.org
[duckdb]: https://duckdb.org
[bun]: https://bun.sh
[om]: https://mastra.ai/docs/memory/observational-memory
