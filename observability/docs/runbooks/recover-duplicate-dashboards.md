# Recovering from duplicated dashboards

On 2026-11-08 the account briefly held two complete copies of every board, plus
duplicated alert policies — 61 names, each twice. This runbook is that
recovery, written down.

## How the incident happens

Publishing from this stack is Floci-only (`envs/.env`, `PLANE=floci` — the
emulator's S3 bucket `detectai-observability-tfstate-000000000000` holds the
state). When the emulator's filesystem loses that bucket — container
recreation, `make floci-clean`, a `--purge-state` teardown — terraform quietly
plans *"add everything"* on the next apply, because the boards it created live
on the New Relic side, not in the emulator. Applying blind fans out a second
full copy: 13 boards, 7 policies, the email destination, channel and workflow,
all duplicated in the same run.

The tell-tale: `make plan` says **"N to add"** while the boards visibly exist
on the account. Never let that plan run; an apply before state is recovered
creates the copy.

## Recovery

Everything below runs against the EU GraphQL API with the user key from
`envs/.env`. Read the current picture first:

```bash
make plan    # expect "No changes." — with empty state it says "N to add": stop here
make audit   # names every duplicated board with its GUIDs and creation dates
```

Then, in order:

1. **Delete the orphan board generation.** `dashboardDelete` takes one GUID per
   call; pages tag along with their parent board, so delete parents only:

   ```graphql
   mutation($g: EntityGuid!) { dashboardDelete(guid: $g) { status } }
   ```

   Keep one generation alive until the re-apply below finishes (the newest
   usually — its GUIDs are what the lost state was creating on Nov 8). Delete
   the older generation, plus any board outside the declared set (untagged,
   older creation date).

2. **Delete both copies of the alert plane** — state is empty either way, the
   apply recreates them fresh. The workflow first (its issue filter references
   policy ids), then channels, destinations, then all `detectai-*` policies:

   ```graphql
   mutation { aiWorkflowsDeleteWorkflow(accountId: 6428768, id: "<uuid>") { id } }
   mutation { aiNotificationsDeleteChannel(accountId: 6428768, channelId: "<uuid>") { ids } }
   mutation { aiNotificationsDeleteDestination(accountId: 6428768, destinationId: "<uuid>") { ids } }
   mutation { alertsPolicyDelete(accountId: 6428768, id: "<id>") { id } }
   ```

   The policy delete evicts its conditions with it.

3. **Re-apply from the stack's HEAD** so state, git and the account agree:

   ```bash
   make auto-apply   # ends with the board audit
   ```

4. **Delete the generation you kept alive in step 1** — the same
   `dashboardDelete` mutation, this time on the surviving twin parents.

5. **Verify**: `make plan` → *"No changes."* and `make audit` → clean.

## Notes

- Ownerless page entities (boards whose parent is long gone, e.g. the loadtest
  pages) fail both `dashboardDelete` and `entityDelete` — they are index
  remnants that leave entity search on their own. `make audit` warns about
  unmanaged boards and pages instead of failing on them.
- `make audit` runs after `apply`/`auto-apply` automatically; any fresh apply
  that produces a second copy fails the target instead of sitting silently in
  the UI for a week.
- `make apply` and `make auto-apply` are also guarded *before* they run: the
  captured plan is parsed and, if it proposes creating a board that is already
  live on the account, the apply is refused (`scripts/plan-guard.py`). A brand
  new board still applies normally.
