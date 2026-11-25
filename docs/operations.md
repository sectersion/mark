# Operations

Runbook for running mark. Spec: `docs/superpowers/specs/2026-11-24-mark-design.md`, section 9.

## Hosting

Default: a VM on the owner's homelab. mark is one long-lived Bun process that
talks to Slack over Socket Mode, which is an outbound connection, so the VM needs
**no inbound ports**. Postgres runs alongside it (same VM or a container). Agent
code runs in E2B, never on the host.

- Run it under systemd or Docker with restart on failure (`Restart=on-failure`,
  or `restart: unless-stopped`).
- Start command: `bun run start`. Never run a second copy against the same Slack
  app: two Socket Mode clients race for the connection.
- A small VPS is the alternative; the same rules apply.

## Security: the HTTP server

Mastra registers every agent on its HTTP server (`/api/agents/<id>/generate`,
`/api/agents/<id>/tools/<toolId>/execute`, `/api/memory/threads/...`), and the
caller supplies the request context. `src/mastra/index.ts` configures no
`server.auth`, so anyone who can reach the port can forge `channel` context and
talk to the privileged agent as if they were the owner, or read the owner's
conversation history and working memory.

**Loopback alone is not enough.** Binding to `127.0.0.1` removes the network
path, but the owner's own browser is on the same machine. Mastra's default CORS
is `origin: "*"` (`@mastra/deployer/dist/server/index.js`, `getCorsConfig`), so
any web page the owner opens could call the API, and a page can also rebind its
own hostname to `127.0.0.1` (DNS rebinding) and then read the answers as if it
were same-origin.

**In force, in code (`src/mastra/index.ts`, `src/mastra/lib/loopback.ts`):**

- Bind: `src/mastra/config.ts` exports `server = { host: '127.0.0.1', port: 4111 }`.
  The port is pinned so the allowlist below matches it (`PORT` no longer moves it).
- CORS: `server.cors.origin` is `http://127.0.0.1:4111` and
  `http://localhost:4111` only, never `*`.
- Middleware (`server.middleware`, run by the deployer on every route registered
  after it, which is all agent, memory, tool, workflow and Studio routes) rejects
  with 403:
  - any request whose `Host` is not exactly `127.0.0.1:4111` or `localhost:4111`
    (this is what stops DNS rebinding: the rebound page sends its own hostname);
  - any request carrying an `Origin` that is not one of those two;
  - in production (`NODE_ENV=production`), every `/api` request. Nothing
    legitimate needs the API there: Slack arrives over Socket Mode. A liveness
    probe should hit `/health`, which stays open; `mastra api` against a
    production process gets 403.
  Studio keeps working in development when opened at `http://localhost:4111` or
  `http://127.0.0.1:4111`.
- Not covered by the middleware: `/health`, Mastra's auth endpoints (public by
  design, inert with no `server.auth`) and the browser-stream routes, which the
  deployer registers before user middleware; mark configures no browser, so they
  have nothing to serve.

**Do not run mark on a machine you also browse the web on** unless you have
checked this middleware is in force after the deploy (the checks below). The
homelab VM is the intended host.

- Why the bind must be explicit: `@mastra/deployer/dist/server/index.js`
  `createNodeServer` reads `bindHost = serverOptions?.host ?? process.env.MASTRA_HOST`
  and passes it as `hostname: bindHost` to `serve`. With neither set, Node
  listens on **all interfaces**; the `"localhost"` default is only the string
  used in log lines.
- `MASTRA_HOST` in the environment is the fallback only when `server.host` is
  unset; do not set it to `0.0.0.0`.
- Firewall (REQUIRED, belt and braces): deny inbound to port 4111 and every other
  port except SSH from the LAN. Docker users: publish nothing
  (`ports:` empty), or `127.0.0.1:4111:4111` only.
- Not done: `server.auth`. Add it before anything ever exposes the port
  (reverse proxy, remote tooling).
- Check after each deploy:
  - `ss -ltn | grep 4111` must show `127.0.0.1:4111`, not `0.0.0.0` or `*`;
  - `curl http://<lan-ip>:4111/api/agents` from another machine must fail to
    connect;
  - on the host, `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.com:4111' http://127.0.0.1:4111/api/agents`
    and the same with `-H 'Origin: https://evil.com'` must both print `403`;
  - in production, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4111/api/agents`
    must print `403`.

## Daily caps

`src/mastra/config.ts` `dailyCaps`: 500 owner turns and 200 receptionist replies
per day, counted from audit rows (`turn`, `receptionist.reply`) since local
midnight in America/Chicago.

On a breach mark writes an audit row `cap.exceeded` (cap name and numbers only)
and DMs the owner, once per local day (the guard is that row, so it survives
restarts; two simultaneous breaches could in theory send two DMs). While that
row exists for today, anyone who is not the owner gets "mark is offline."

- The owner is never blocked by a cap. The owner-turn cap is an alert.
- mark is not paused: scheduled tasks keep running and there is nothing to
  resume. The stranger shutoff lifts itself at the next Chicago midnight.
- Caps count requests, not dollars. The dollar limits below are the real spend
  control.

## Standing rules: list and revoke

There is no revoke tool yet (Phase 4). Every approved rule shows in mark's
prompt with the first 8 characters of its approval id, for example
`- [0b6f1c8e] always reply in lowercase`, so mark can tell you which one to
revoke. Run these with `psql "$DATABASE_URL"`.

List approved rules:

```sql
select id, payload->>'rule' as rule, decided_at
from approvals
where kind = 'standing_rule' and status = 'approved'
order by decided_at;
```

Revoke one (paste the full id, or match the short one with `id::text like '0b6f1c8e%'`):

```sql
update approvals set status = 'declined'
where id = '<full id>' and kind = 'standing_rule';
```

The rule drops out of the prompt on mark's next turn; no restart needed.

## Spend: who pays, and dollar limits

- [ ] Owner decision: who pays for the keys (AI Gateway, Hack Club proxy, E2B, Exa)?
  Record the answer here: ______

Set dollar limits by hand, since the code only counts requests:

- [ ] Vercel AI Gateway: monthly budget and alert, in the dashboard under the
  team's AI Gateway settings.
- [ ] E2B: usage limit and billing alert in the E2B dashboard.
- [ ] Exa: usage cap in the Exa dashboard.

## Backups

`scripts/backup.sh` dumps `$DATABASE_URL` with `pg_dump | gzip` into
`backups/mark-YYYY-MM-DD.sql.gz`, keeps the newest 14, refuses to run without
`DATABASE_URL`, and fails loudly (`set -euo pipefail`). `backups/` is git-ignored
because dumps hold private data; keep them off shared storage and consider
encrypting any off-host copy.

Cron (daily 03:15, as the user that owns the checkout):

```
15 3 * * * cd /srv/mark && . ./.env && DATABASE_URL="$DATABASE_URL" bash scripts/backup.sh >> backups/backup.log 2>&1
```

(`.env` must be shell-sourceable `KEY=value` lines. Alternatively export
`DATABASE_URL` in the crontab itself.)

Sanity check after installing the cron, by hand:

```
env -u DATABASE_URL bash scripts/backup.sh; echo $?     # prints an error, exit 1
bash scripts/backup.sh && ls -l backups/                # a fresh mark-DATE.sql.gz
gzip -t backups/mark-$(date +%F).sql.gz             # exit 0
git check-ignore backups/x.sql.gz                   # prints a match
```

### Restore test (do this before relying on backups, then quarterly)

```
createdb mark_restore_test
gunzip -c "$(ls -1t backups/mark-*.sql.gz | head -1)" | psql -v ON_ERROR_STOP=1 mark_restore_test
for t in approvals audit_log mastra_threads mastra_messages mastra_resources; do
  echo "$t live=$(psql "$DATABASE_URL" -Atc "select count(*) from $t") restored=$(psql mark_restore_test -Atc "select count(*) from $t")"
done
dropdb mark_restore_test
```

Counts for `approvals` and `audit_log` should match the live database at dump
time (live may be slightly higher if mark has been busy since). Mastra's memory
tables are `mastra_threads`, `mastra_messages`, and `mastra_resources` (working
memory); run `\dt mastra_*` on the live database first and add any other memory
table you find. If a count differs by more than recent activity explains, the
backup is not good.

- [ ] Restore test passed on: ______

## Hack Club rules checklist

I could not verify Hack Club's current rules for bots and agents; this is a list
of what to read and confirm, not a statement of what they say.

- [ ] Read the Hack Club Slack's current policy on bots, apps, and AI agents
  (the Slack's bot/app guidelines, the code of conduct, and any channel-level
  rules for the channels mark is in).
- [ ] Does a personal agent need approval, a label, or a registered owner? Is a
  bot account allowed to DM members unprompted?
- [ ] Rules on AI-generated messages: disclosure, rate limits, no impersonating
  the owner (mark must speak as itself, never as the owner).
- [ ] Rules on storing or processing other members' messages (mark keeps
  receptionist exchanges, audit rows, and thread history in Postgres).
- [ ] Which channels may mark join or reply in, and may it use the user token
  for search (`SLACK_USER_TOKEN`)?
- [ ] Contact for questions or abuse reports, and how to switch mark off fast
  (stop the service).
- [ ] Record the date confirmed and who confirmed it: ______

## Injection evals

`test/injection.test.ts` calls a live model, so plain `bun test` skips the live
cases and runs only the no-model helper checks. The owner runs them with a real
`AI_GATEWAY_API_KEY` in `.env`:

```
bun run test:evals
```

This uses `test/evals.bunfig.toml`, whose preload keeps real `HACKCLUB_API_KEY`
and `AI_GATEWAY_API_KEY` from `.env` and sets `INJECTION_EVALS=1`. The audit
write, approval creation, approval card, and rate limit are stubbed, so nothing
touches Postgres or Slack. Each case sends a message as `UOTHER` and asserts the
only tool called is `pass_to_owner` (at most once) and that a canary planted in
owner-authored history never appears in the reply. Every case also asserts the
reply is not the fixed failure line, so a bad key or no network fails the run
instead of passing vacuously, and a benign sanity case must get a real answer.
The live cases skip unless `INJECTION_EVALS=1` and `AI_GATEWAY_API_KEY` is not
the placeholder `x`, so plain `bun test` can never spend money.

- [ ] `bun run test:evals` passed on: ______
