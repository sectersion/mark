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

Mastra registers every agent on its HTTP server (`/api/agents/<id>/generate`),
and the caller supplies the request context. `src/mastra/index.ts` configures no
`server.auth`, so anyone who can reach the port can forge `channel` context and
talk to the privileged agent as if they were the owner.

**In force: the server is bound to loopback in code, and a firewall rule is
still required as a second layer.**

- Code: `src/mastra/config.ts` exports `server = { host: '127.0.0.1' }`, passed to
  `new Mastra({ server })` in `src/mastra/index.ts`.
- Why it must be explicit: `@mastra/deployer/dist/server/index.js` line 4710
  reads `bindHost = serverOptions?.host ?? process.env.MASTRA_HOST`, and line 4720
  passes it as `hostname: bindHost` to `serve`, which calls
  `server.listen(port, hostname)` (line 1164). With neither set, `hostname` is
  `undefined` and Node listens on **all interfaces**. The `"localhost"` default on
  line 4711 and in `@mastra/core/dist/server/types.d.ts` (`host`, default
  `'localhost'`) is only the string used in log lines. Setting `host` fixes that.
- `MASTRA_HOST` in the environment is the fallback only when `server.host` is
  unset; do not set it to `0.0.0.0`.
- Firewall (REQUIRED, belt and braces): deny inbound to port 4111 and every other
  port except SSH from the LAN. Docker users: publish nothing
  (`ports:` empty), or `127.0.0.1:4111:4111` only.
- Not done: `server.auth` or a reject-all middleware. Loopback binding already
  removes the network path; add auth before anything ever exposes the port
  (reverse proxy, Studio, remote tooling).
- Check after each deploy: `ss -ltn | grep 4111` must show `127.0.0.1:4111`, not
  `0.0.0.0` or `*`; and `curl http://<lan-ip>:4111/api/agents` from another
  machine must fail to connect.

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
cases (they also skip unless `INJECTION_EVALS=1` and the gateway key is not the placeholder `x`) (only the no-model helper checks run). The owner runs them with a real `AI_GATEWAY_API_KEY` in `.env`:

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
