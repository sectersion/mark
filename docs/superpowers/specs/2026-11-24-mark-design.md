# mark: design

A personal assistant for one person, living in Slack. Fork of gorkie (a team
Slack bot on Bun, TypeScript, Mastra channels, E2B, Postgres). Status: draft
for approval.

## Intent

The owner, a developer with many projects across several GitHub orgs, wants an
assistant that takes chores off their plate: an engineering radar and news briefing, owning their schedule and
meetings, and more over time. It runs in the Hack Club Slack workspace, which
auto-approves apps. It works with the whole workspace, but only for the owner's
benefit. Think of a receptionist: anyone can talk to the front desk, only
The owner can direct mark, and when the desk needs them it asks.

## Goals

- One Slack app named mark, one bot identity. It never posts as the owner and
  never holds their DMs or private channels.
- Two agents behind it, routed by the sender of each message:
  - **mark** (privileged): only the owner can ping it.
  - **receptionist** (unprivileged): anyone else who pings the app reaches it.
- Mark owns the owner's schedule. No external calendar. `.ics` in and out.
- Daily briefing: an engineering radar (PRs, CI, issues needing a decision
  across their GitHub orgs) plus news tuned to their interests.
- Mark learns, writes its own skills, and can open pull requests against its
  own code. It never merges.
- Mark can delegate to subagents, and can connect to MCP servers when the owner
  supplies the details.
- Extensible: adding a capability means adding one tool with a trust tag.
- Runs as a proper Slack agent (`agent_view`, `assistant:write`, session
  status), building on what the manifest already enables.

## Non-goals

- Acting as the owner, or reading their DMs or private channels. The existing
  search credential stays `search:read.public` only, and the code that
  refuses broader scopes stays.
- Syncing to Google or Outlook calendars.
- Letting anyone but the owner reach mark.
- A rewrite. We evolve gorkie in place.
- Migrating gorkie data. This is a fresh deployment.

## Anti-goals (failures even if it technically works)

- A stranger's message, or another person's agent, steering a privileged
  action, including through thread history, forwarded text, file contents, or
  news articles.
- Self-improvement that can be triggered or shaped by anyone but the owner.
- Mark merging its own pull requests, or changing its own trust rules without
  the owner reviewing the diff.
- Leaking schedule detail (titles, attendees, locations) to others. Others
  see free/busy only, and only if the owner allowlisted them; everyone else
  sees nothing.
- The receptionist stating anything personal about the owner (age, location,
  school, identity). It says only that it is the owner's assistant's front
  desk.
- A secret (MCP token) ending up in Slack message history.

## Constraints

- Repo rules in `AGENTS.md` and `CODING_STANDARDS.md` apply. Ask first before
  dependency changes and schema-shape changes. Never read `process.env`
  outside `src/env.ts`. Never run agent code on the host. Never start or kill
  the running bot.
- Every model in `providers.ts` needs at least 1M input tokens.
- Add requests to `TODO.md`; move finished items to `IMPLEMENTED.md` with
  detail.
- Hack Club is a large workspace with many people and personal agents. Treat
  every non-owner message as untrusted data.

## Approaches considered

How to enforce "don't trust strangers":

1. One agent, approval on sensitive tools. Smallest change, but a stranger's
   text shares context with privileged tools.
2. One agent, toolset chosen per turn by speaker. About 80% of the safety for
   less work. Fallback.
3. Two agents, a receptionist and mark. **Chosen by the owner.** The receptionist
   is the only agent strangers reach. Mark holds the privileged tools and
   self-improvement and is reached only by the owner, plus a structured handoff
   from the receptionist.

How many Slack apps: **one app, routed by sender (chosen by the owner)**, versus
two apps with separate names and tokens. One app is simpler to run.

Where self-written skills live: **Postgres with an approval card (chosen by
the owner)**, versus PRs to `workspace/skills/`. Code changes still go only
through PRs.

Evolve in place was chosen over a rewrite because the Slack plumbing,
streaming, memory, scheduled tasks, MCP, and GitHub tools already work.

## Design

### 1. Owner identity and routing

- `OWNER_SLACK_USER_ID` in `src/env.ts`. Identity is the Slack user ID from the
  event, never a name or message text. Interaction payloads (button presses,
  modal submits) are checked against it too.
- Per message: sender is the owner, goes to **mark**. Anyone else goes to the
  **receptionist**.
- **Taint rule (designer's call).** A turn is a receptionist turn if it loads
  any non-owner-authored content. Mark's memory, learned facts, skills,
  subagent definitions, and scheduled-task prompts are written only from owner
  messages. Anything a stranger, another agent, or a news article supplies is
  stored and shown as data, never as instructions. The briefing and any
  background run use a minimal toolset.
- In a thread with both owner and non-owner messages, the owner's words are
  unverified context. Mark nudges the owner to continue in DM.
- **Receptionist tools:** reply, take a message, check free/busy, request a
  meeting, ask the owner. No access to the owner's memory, GitHub, MCP, sandbox,
  scheduled tasks, or private content. It keeps only handoff requests, with no
  per-stranger profiles.
- **Receptionist rate limit** (designer's call, light per-user limit) because
  the workspace is large and open.
- **Handoff:** the receptionist writes a structured request (who, what, when,
  proposed slots). Mark DMs the owner a card with Approve / Decline. The
  decision is delivered back to the requester by the receptionist. Pending
  requests expire (default 24h; the builder may tune).
- **One authorization channel:** the DM card. All approvals (events, skills,
  subagents) use one Postgres approvals table that survives restarts.
- The receptionist refuses plainly and offers to ask the owner, never argues.

### 2. Schedule and `.ics`

- Events stored in Postgres (new tables, a schema change that needs the owner's
  OK at plan time, with exact schemas shown for sign-off). Recurrence stored
  as RRULE text and expanded on query. Time zone stored per owner
  (America/Chicago, confirmed by the owner).
- Tools: add, move, cancel, list, find free time. By default the receptionist
  sees no schedule at all. For people the owner has allowlisted it sees only
  free/busy, in 30-minute blocks within the owner's "meeting hours" (hours
  they are open to meetings or calls, set in conversation), over a 14-day
  horizon (designer's call).
- `.ics` skill plus parser: import from an uploaded file or URL, export an
  event as an `.ics` attachment. The parser wraps an existing library
  (`ical.js` or `node-ical`; dependency needs the owner's OK), not hand-written,
  because RRULE and time zones are the hard part.
- Owner approval is required for any event a stranger requested.

### 3. Briefing

- A scheduled task (existing mechanism, `tools/scheduled-tasks`) posting to
  the owner's DM.
- **Engineering radar:** PRs awaiting review, CI failures, stale PRs
  (including the open hackatime upstream PR), issues needing a decision,
  across their GitHub orgs, using existing GitHub tools.
- **News:** Exa search tuned to their interests (agent and MCP tooling, Claude
  Code, Cloudflare Workers, Rust, RISC-V and CH32, KiCad, Meshtastic, Hack
  Club announcements). Short, not a feed.
- No task exists until the owner sets topics and a delivery time (designer's
  call). Prerequisite: the scheduled-task wake fix in `TODO.md` must be
  verified live.

### 4. Self-improvement

All paths run only in the mark agent and only from the owner's messages.

- **Learn:** durable facts and preferences saved to memory (see section 5).
- **Skills:** mark writes and edits its own skills (markdown instructions) in
  Postgres. A proposal appears as a DM card with the full text; it takes
  effect only after the owner approves. The builder must check whether Mastra's
  workspace skill source can read a custom (database) source. The fallback is
  a host data directory owned by a dedicated tool, not the repo checkout.
- **Subagents:** mark keeps delegating to subagents (`research`, `explore`,
  plus new ones). New subagent definitions follow the same proposal and
  approval path as skills.
- **MCP:** the owner supplies a server's URL and token and mark connects, using
  the existing per-user server flow. The token is collected through a Slack
  modal, not a chat message. The existing SSRF and security probing stays.
- **Code:** mark opens pull requests against its own repo with the existing
  GitHub tools. It never merges. Enforced by GitHub branch protection on
  `main` and a token that can push branches and open PRs but cannot merge
  (not by prompt). Changes touching the trust gate, the owner check, or the
  receptionist toolset are called out in the PR description; the builder
  decides how to detect them (path list is the likely approach).

### 5. Memory

Today memory is thread-scoped Observational Memory (`scope: 'thread'` in
`agents/orchestrator.ts`), so mark forgets everything between Slack threads.
Mastra deprecates resource-scoped Observational Memory and documents it as
worse (breaks prompt caching, mixes threads, slower), so it is not used.
Chosen by the owner: three layers, each with one job.

1. **Working memory, resource-scoped to the owner.** A persistent record of
   durable facts (preferences, projects, people, standing rules) that follows
   the owner across every thread, stored in Postgres. Structured with a schema
   so each fact carries its source and date, and so a fact can be listed,
   edited, or deleted. The builder chooses the exact shape (Mastra's schema
   merge replaces arrays, so facts are likely an object keyed by id).
2. **Observational Memory, kept thread-scoped.** It compresses each
   conversation, with the existing prompts that treat quoted, fetched, and
   tool-produced content as untrusted.
3. **Recall tool.** Lets mark look back through the owner's past threads for
   exact wording (Mastra's retrieval mode, resource-scoped by default).

Security rules:

- **Write gating.** On any turn that loads non-owner content, working memory
  is passed `readOnly: true`. This is the taint rule enforced in code.
- **Two kinds of memory, two rules.** Plain facts save automatically.
  Anything that changes mark's behavior (a standing rule, "always do X")
  goes through the DM approval card first. A page mark read cannot plant a
  standing instruction.
- **Receptionist isolation.** The receptionist uses a different resource id
  and has no memory tools pointed at the owner's records.
- **Visible and controllable.** The owner can ask "what do you know about me"
  and tell mark to forget something.
- **No secrets in memory.** Tokens stay in the encrypted credentials table
  (`CREDENTIALS_KEY`). The existing observer prompts already omit secrets.
- **No personal identifiers by default.** Mark does not store address,
  school, age, or similar unless the owner explicitly tells him to.
- **Storage.** Memory is not encrypted by the app. Production Postgres should
  use disk encryption and a strong credential (designer's call, operational).

**Known gap (Phase 1).** The taint rule is per thread, decided before the turn
starts. Content mark reads during an untainted turn (fetched pages, history
reads, MCP results, approval cards in the owner DM) can still steer that turn's
working memory writes, because nothing re-checks taint inside the turn. Phase 1
narrows it: standing rules always need the DM approval card, and
`create_scheduled_task` needs the owner's approval press. Phase 3 adds an
in-turn gate that makes memory read-only once a turn has loaded untrusted
content.

Left to the builder: verify what resource id Slack channels passes to the
agent (dependencies were not installed during design, so Mastra's bundled
docs were not read), and confirm `readOnly` works per call under channels.

### 6. Personality

Replaces gorkie's personality prompt (`prompts/personality.ts`: "Gork's
sister", she/it). Mark and the receptionist get separate prompts.

**mark** (he/him):

- Lazy in the good way ("agi if it was lazy"): does the minimum that works,
  says so, doesn't pad.
- Smart but casual. Lowercase by default, short answers, matches the owner's
  typing style. Hack Club register, with the workspace's custom emoji
  (`:heavysob:`, `:skulk:`) used sparingly.
- Swears a little: mild, occasional, never at people, never to non-owners.
- Small opinions only: tooling, wording, ordering, "that fourth deadline
  isn't real". Not big life or project decisions; those he lays out and
  leaves to the owner.
- Reports like a good coworker: what's done, what's waiting on the owner,
  what he guessed. He never presents a guess as a fact.
- Keeps gorkie's writing rules: no dashes, no filler, no canned AI phrasing.

**receptionist** (a deliberately different voice so people can tell who they
are talking to): polite, brief, unflappable. Never swears, never argues,
never explains why it can't share something, never guesses. It calls itself
mark's front desk, refers to the owner only as "they", and offers two things:
take a message, or ask.

### 7. Slack agent surface

Already in the manifest: `agent_view`, `assistant:write`,
`app_context_changed`, suggested prompts. Left to the builder: verify whether
Mastra channels already drives `agents.sessions.setStatus` and the stop
button, and add them only if missing.

### 8. Safety controls

- **Outbound rule.** Mark never starts a conversation with another person
  (DM or new thread) without an approval card. Replies inside a thread the
  owner started, or to someone who messaged the receptionist, are allowed.
  Enforced in the tool that posts, not in the prompt.
- **Kill switch.** An owner-only "pause" command that, in one step, turns off
  the receptionist, scheduled tasks, and self-PRs. While paused, non-owners
  get a fixed "mark is offline" reply. "Resume" is owner-only and goes through
  the same user ID check.
- **Audit log.** One Postgres table recording everything mark does that
  touches anyone else or changes his own behavior: messages sent, approvals
  and their outcome, events booked, skills and subagents added, MCP servers
  connected, PRs opened, pause and resume. The owner can ask "what did you do
  today" and mark answers from the log, not from memory.

### 9. Operations (plan tasks, not design-level)

- **Spend cap.** A hard daily limit across model, E2B, and Exa usage that
  pauses mark and DMs the owner. Who pays for the keys is an open item.
- **Backups.** Scheduled Postgres backups (memory, skills, schedule,
  approvals, audit log) plus a tested restore.
- **Injection test set.** About 10 runnable cases (ignore-previous
  instructions, a forged owner message, a poisoned web page) against the
  receptionist and the memory gate, using the existing Langfuse setup.
- **Hosting.** Mark is a long-lived Bun process using Slack Socket Mode (no
  inbound ports needed), with Postgres. Agent code runs in E2B, never on the
  host. Default is a VM on the owner's homelab; a small VPS is the alternative.
- **Hack Club rules.** Read their rules for bots and agents before launch.

## Build order

1. Owner identity, routing, the receptionist/mark split, the handoff card
   with the approvals table, owner-scoped working memory with write gating,
   the two personality prompts, the outbound rule, the kill switch, and the
   audit log.
2. Schedule tables and the `.ics` skill and parser.
3. Briefing: engineering radar and news.
4. Learning, self-written skills and subagents, MCP by modal, and self-PRs.

## Left to the builder

Tool names and file layout, the receptionist prompt, request expiry timing,
which `.ics` library, how session status is wired, rebranding the manifest and
README from gorkie to mark, and removing team-bot features that don't serve a
personal assistant (opt-in channel, per-user settings). Because this is a
fresh deployment, the builder does not need a data migration.

## Open items for the owner

- Set meeting hours and an allowlist of people who may see free/busy. The
  briefing defaults to 7:30 AM America/Chicago until changed.
- Issue mark a GitHub token that can push branches and open PRs but cannot
  merge. Branch protection on `main` is already on (one approving review,
  no force pushes, no deletion, admin bypass left on for the owner).
