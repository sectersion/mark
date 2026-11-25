<!-- cspell:ignore Dxiw -->

# Mastra assumptions (Task 3 spike)

Checked against the installed packages: `@mastra/core` 1.66.0, `@mastra/memory`
1.29.0, `@mastra/pg` 1.24.0, `chat` 4.35.0, `@chat-adapter/slack` 4.35.0. Paths
are relative to `node_modules/`. Line numbers are for these exact builds.

## 1. resourceId channels passes to memory (Task 9)

**Answer: per user, across every channel, thread, and DM. The value is
`slack:<userId>` of the author of the message that first created the Mastra
thread.** An existing Slack thread keeps the resourceId stored on it.

- `@mastra/core/dist/agent-CEHR0Wd8.js:21195`:
  `const defaultResourceId = \`${platform}:${message.author.userId}\`;`
  (`platform` is the adapter name, `slack`, so this is `slack:U123`, the same
  string `chatChannelId(userId)` in `src/mastra/lib/ids.ts` builds).
- `agent-CEHR0Wd8.js:21611`: `getOrCreateThread` returns the existing mapped
  thread unchanged (`if (existingThread) return existingThread;`), so only a
  new thread uses the default.
- `agent-CEHR0Wd8.js:21215` and `:21340-21343`: the turn runs with
  `memory: { thread: mastraThread.id, resource: threadResourceId }`, the stored
  owner of the thread, not the current sender.

**Can `memory: { resource }` be overridden in `defaultOptions`? No.**
`agent-CEHR0Wd8.js:37814` merges `deepMerge(defaultOptions, streamOptions)`, and
`@mastra/core/dist/utils-CERGaOZo.js:755-765` lets the second argument win, so
the `memory.resource` channels passes always beats a default. The wake path
also sends `resourceId: memory.resource` straight to `sendMessage`
(`agent-CEHR0Wd8.js:20594`). Even if it did apply, the working memory tool
throws when the thread's stored resourceId differs
(`@mastra/memory/dist/src-BNB8ko_o.js:22825`). The handler path cannot override
it either: `defaultHandler` takes only `(thread, message)`
(`agent-CEHR0Wd8.js:20689`).

The supported override is `channels.resolveResourceId`
(`@mastra/core/dist/channels/types.d.ts:566-586`, used at
`agent-CEHR0Wd8.js:20573-20581`), and it only affects newly created threads.

**What to do in Task 9:** nothing extra. After Task 6 only an untainted owner
message reaches `defaultHandler`, so every Mastra thread mark creates belongs to
`slack:<OWNER_SLACK_USER_ID>`, and `scope: 'resource'` working memory is already
one shared record for the owner. Do not add `memory: { resource }` to
`defaultOptions` (it is silently ignored, and the raw id form would be wrong
anyway). Only if threads created before phase 1 by other users must be excluded,
note that their stored owner is that other user, so they never read the owner's
record, which is the safe direction.

## 2. `bot.onAction` event shape (Task 8)

**Answer: yes. `event.value` is the clicked button's `value`, `event.user.userId`
is the clicker's Slack id, `event.messageId` is the card's `ts`, and
`event.threadId` encodes the channel. Action ids match exactly only: no prefix
or regex.**

- `@chat-adapter/slack/dist/index.js:1866-1882` (`handleBlockActions`):
  `value: action.selected_option?.value ?? action.value`,
  `user: { userId: payload.user.id, ... }`, `messageId` is `payload.message.ts`
  (`:1852`, `:1865`), `threadId` is `encodeThreadId({ channel, threadTs })` with
  `channel = payload.channel.id` (`:1851`, `:1859-1862`). `raw` is the full Slack
  payload. The repo's `SlackAgentAdapter` (`src/mastra/chat/adapter.ts`) does not
  override `handleBlockActions`.
- `chat/dist/types-BtpYwkzQ.d.ts:2055-2083`: `ActionEvent` has `actionId`,
  `value?: string`, `user: Author`, `messageId`, `threadId`,
  `thread: Thread | null` (null only for view actions such as App Home), `raw`.
- `chat/dist/index.js:2492-2499` and `:3129-3141`: `onAction(id | id[], handler)`
  matches with `actionIds.includes(event.actionId)`; `onAction(handler)` is a
  catch-all. There is no prefix matching.
- Mastra channels registers its own catch-all action handler that acts on ids
  starting with `tool_approve:` or `tool_deny:` (`agent-CEHR0Wd8.js:20755-20759`).
  Our ids must not use those prefixes.
- Existing use: `src/mastra/chat/app-home/scheduled-tasks/actions.ts` already
  reads `event.value` (a schedule id) and `event.user.userId`.

**What to do in Task 8:** keep the plan's encoding. Two fixed action ids
(`approval_approve`, `approval_decline`) with `value` set to the approval uuid,
registered as `bot.onAction(['approval_approve', 'approval_decline'], ...)`.
The prefix fallback is not needed. Get the card channel with
`slack.decodeThreadId(event.threadId).channel` and the ts from `event.messageId`.
For `already_resolved` and `expired`, `event.thread?.postEphemeral(event.user,
text, { fallbackToDM: true })` works because a DM card's `thread` is non-null.

## 3. Calling an Agent with no `channels` via `.generate` (Task 7)

**Answer: yes.** There is already a precedent: `summarizer` is registered in
`new Mastra({ agents })` with no channels and is called directly as
`await summarizer.generate(prompt)` in
`src/mastra/tools/slack/summarize-thread.ts:76`.

- Signature: `@mastra/core/dist/agent/agent.d.ts:1229-1234`,
  `generate(messages, options?) => Promise<FullOutput>`. Options are
  `AgentExecutionOptionsBase` (`agent/agent.types.d.ts:471`), which includes
  `memory?` (`:479`) and `requestContext?: RequestContext` (`:498`). No memory
  is needed when the agent has none.
- Return shape: `@mastra/core/dist/stream/base/output.d.ts:26-75`.
  `text: string` is every step's text joined
  (`trip-wire-DHDxiwCS.js:4313`, `steps.map((step) => step.text || "").join("")`),
  so it is `''` when the model only called a tool.
  `toolCalls: ToolCallChunk[]` covers all steps (pushed at
  `trip-wire-DHDxiwCS.js:3750`, resolved at `:4013`). Each element is
  `{ type: 'tool-call', payload: { toolCallId, toolName, args } }`
  (`stream/types.d.ts:1077-1080` and `:146-151`), so the tool name is
  `call.payload.toolName`, not `call.toolName`. `toolResults` has the same
  `payload` wrapper. `error` and `tripwire` are also on the result.
- Request context to tools: `ToolExecutionContext.requestContext`
  (`@mastra/core/dist/tools/types.d.ts:461-463`). Build it with
  `new RequestContext()` from `@mastra/core/request-context` and `.set(key,
  value)` (`_types/@internal_core/dist/request-context/index.d.ts:82-91`).
  Avoid the reserved `mastra__*` keys.

**What to do in Task 7:** in `receptionistTurn`, create
`const requestContext = new RequestContext(); requestContext.set('channel',
{ userId: message.author.userId, threadId: thread.id, channelId:
thread.channelId, isDM: thread.isDM })` and pass it to
`receptionist.generate(input, { requestContext })`. Setting the same `channel`
key channels uses means `pass_to_owner` reads `requesterId` and `replyThread`
with the existing `channelContext(context.requestContext)` helper
(`src/mastra/lib/context.ts`), no new parser. Only post `.text` when it is
non-empty after trimming. Tool calls for the Task 13 injection tests are
`result.toolCalls.map((call) => call.payload.toolName)`.

## 4. Working memory with `scope: 'resource'` and a schema on `@mastra/pg` (Task 9)

**Answer: yes. Pass a Zod schema object directly as `workingMemory.schema`.**

- Type: `@mastra/core/dist/memory/types.d.ts:107-158`.
  `SchemaWorkingMemory = { enabled; scope?: 'thread' | 'resource'; schema:
  PublicSchema; template?: never }`. `scope` defaults to `'resource'`. Used in
  `MemoryConfig.workingMemory` (`:1003`). Zod v4 is accepted
  (`@mastra/memory/dist/docs/references/docs-memory-working-memory.md:278`).
- `@mastra/pg` is listed as supporting resource-scoped working memory
  (`docs-memory-working-memory.md:128-136`) and implements the resources table
  (`@mastra/pg/dist/index.js:10349`, `getResourceById` at `:11588`). The
  orchestrator's `new Memory({ options })` has no `storage`, so it uses the
  Mastra instance's `postgresStore`.
- Coexists with `observationalMemory`. OM only takes over working memory when
  `observation.manageWorkingMemory` is set
  (`src-BNB8ko_o.js:30281-30283`), which we do not set, so the agent gets the
  `updateWorkingMemory` tool (`src-BNB8ko_o.js:31557-31559`).
- Schema mode uses merge semantics (`src-BNB8ko_o.js:22853`,
  `deepMergeWorkingMemory` at `:22732-22745`): nested objects, including record
  entries, merge, arrays replace. The tool is registered with `strict: false`
  (`:22808`), so `z.record` is fine.
- **Gotcha: deleting with `null` does not work for optional or record keys.**
  The docs say "set a field to `null` to delete it", but before validation the
  tool runs `stripNullsFromOptional` (`src-BNB8ko_o.js:22791`, defined at
  `:22746-22761`), which drops every `null` whose key is not in the JSON
  schema's `required`. Record entries are never `required`, so
  `{ facts: { abc: null } }` reaches the merge as `{ facts: {} }` and nothing is
  removed. `validateToolInput` then hands the stripped value to `execute`
  (`@mastra/core/dist/tool-CYfsCURf.js:712-714`).
- `readOnly` is per call: `AgentMemoryOption.options?: MemoryConfigInternal`
  (`@mastra/core/dist/agent/types.d.ts:874-879`) and `BaseMemoryConfig.readOnly`
  (`memory/types.d.ts:813`). Usage: `memory: { thread, resource, options: {
  readOnly: true } }` (`docs-memory-working-memory.md:389-401`). With it set the
  update tool is not offered (`src-BNB8ko_o.js:31557`) and working memory is
  shown read-only (`:30988`). It needs a `thread`, so it cannot be set for a
  channels turn from `defaultOptions` either (see answer 1). The plan does not
  use it in phase 1.

**What to do in Task 9:** `workingMemory: { enabled: true, scope: 'resource',
schema: z.object({ facts: z.record(z.string(), z.object({ text: z.string(),
savedAt: z.string() })).optional(), prefs: z.record(z.string(),
z.string()).optional() }) }`. Make both top-level fields optional so the model
can update one without resending the other. The model cannot forget a fact
through `updateWorkingMemory`; for phase 1 it overwrites the entry instead.
Real deletion needs a small tool calling `memory.updateWorkingMemory({
resourceId, workingMemory: JSON.stringify(next) })`, which replaces the record;
leave that to a later plan unless the owner asks.

## 5. `slack.webClient.conversations.open` and `chat.postMessage` with blocks (Task 8)

**Answer: yes, from anywhere in `src/mastra/`, including the expiry sweep
outside any Slack event.**

- `slack` is the exported adapter from `src/mastra/chat/client.ts`, built with a
  static `botToken: env.SLACK_BOT_TOKEN`. `webClient` resolves the request
  token, else the default bot token
  (`@chat-adapter/slack/dist/index.js:992-1001`; documented at
  `index.d.ts:706-736`). A static string never throws.
- Already called this way: `conversations.open({ users })` in
  `src/mastra/tools/slack/upload-file.ts:16`, `chat.postMessage` in
  `src/mastra/tools/slack/post-message.ts:98` (at the time of this spike;
  `lib/allowed-users.ts`, which also called `conversations.members`, was
  deleted in Task 6).
- Scopes and interactivity are present in `slack-manifest.json`: `chat:write`
  (line 33), `im:write` (line 43), `interactivity.is_enabled: true`
  (lines 79-80).

**What to do in Task 8:** either route works. The shorter one reuses the Chat
SDK card pattern the opt-in code in `src/mastra/chat/onboarding.ts` used at
the time (that file was deleted in Task 6; `src/mastra/chat/approvals.ts` now
uses the same pattern):
`const dm = await chat().openDM(env.OWNER_SLACK_USER_ID)`
(`chat/dist/index.js:3251-3262`, which calls `conversations.open` and returns a
top-level DM thread, `@chat-adapter/slack/dist/index.js:4171-4191`), then
`const sent = await dm.post(Card({ ..., children: [CardText(text),
Actions([Button({ id: 'approval_approve', value: approval.id, ... }),
Button({ id: 'approval_decline', ... })])] }))`. `sent.id` is the card `ts`
(`index.js:3373`) and `slack.decodeThreadId(sent.threadId).channel` is
`card_channel`. Update a card later with `sent.edit(...)` or, after a restart,
`slack.editMessage(threadId, ts, card)` (`index.js:3657`) or
`slack.webClient.chat.update`.

## Other things the controller asked about

- **Post into a thread by id:** `chat().thread(threadId).post(text | Card)`
  (`chat/dist/index.js:3351-3367`; it reads the adapter from the `slack:` prefix
  and needs no event). Already used for the abort notice in
  `src/mastra/agents/orchestrator.ts` (`onAbort`). Thread ids look like
  `slack:C123:1700000000.000100`; a top-level DM is `slack:D123:`.
- **Read earlier messages:** `thread.messages` is an async iterable newest
  first, paginated lazily (`chat/dist/types-BtpYwkzQ.d.ts:1209-1213`);
  `thread.allMessages` is oldest first (`:1333-1338`). `withHistory` in
  `src/mastra/chat/history.ts` iterates `thread.messages`, stops at
  `lastSeenMessage` or 30 scanned, and reverses. For Task 7's "up to 5 earlier
  messages", iterate `thread.messages`, skip `message.id`, take 5, reverse.
- **Schedules from a command handler:** command handlers get no `context.mastra`,
  so use `getMastra()` from `src/mastra/chat/mastra-instance.ts`, then
  `getMastra().schedules`. API: `list(filter?)`, `pause(id)`, `resume(id)`
  (`@mastra/core/dist/schedules/schedules.d.ts:168-184`); the filter takes
  `agentId`, `resourceId`, `status: 'active' | 'paused'` and more (`:145-157`).
  Precedent: `src/mastra/chat/app-home/scheduled-tasks/blocks.ts:11` and
  `actions.ts:18`. For Task 5: `getMastra().schedules.list({ agentId:
  agentConfig.id, status: 'active' })`, then `pause` each id.

## Plan changes made

- **Task 7 Step 3:** added how to pass request context (`channel` key, read with
  `channelContext`), the empty-`.text` guard, and the `payload.toolName` shape.
- **Task 8, `registerApprovals` bullet:** added that action ids match exactly, must not start with
  `tool_approve:`/`tool_deny:`, and that the card can be posted via
  `chat().openDM` plus `Card`/`Button`.
- **Task 9 Step 1:** replaced the `defaultOptions` resource fallback (it cannot
  work, answer 1) with "no override needed; if ever needed use
  `channels.resolveResourceId`", made the schema's top-level fields optional,
  and recorded that `null` cannot delete a fact.
