# Shared Collaboration Queue Review Findings

## Review Scope

`feature/shared-collab-queue` currently contains a design proposal in `NEXT_STEPS.md`, not an executable implementation. There are no collaboration schema changes, migrations, backend endpoints, frontend controls, or tests to validate yet.

The concept is sound, but the following issues should be resolved before implementation and deployment.

## Required Before Implementation

### 1. Replace timestamp revisions with an atomic queue revision

**Severity: High**

The proposed stale-revision protection cannot safely use the current `Channel.updatedAt` value. It is assigned from a JavaScript `Date`, so concurrent mutations can receive the same millisecond timestamp.

Add a monotonic integer revision owned by the canonical queue. Every committed queue mutation should increment it atomically in PostgreSQL. Shared-queue management requests should include the last observed revision and use compare-and-swap behavior, returning a conflict when it is stale. Refresh the queue automatically after a conflict.

### 2. Constrain share-code storage and verification

**Severity: Medium**

The invite code is an ephemeral confirmation value, not the sole authorization mechanism. The invite must be bound to a specific collaborator, and the verified Twitch JWT must prove that the intended broadcaster is accepting it. This makes a separate HMAC secret unnecessary for the MVP.

The implementation should:

- Have the host enter the intended collaborator's Twitch username when creating the invite.
- Resolve that username server-side and bind the invite to the collaborator's immutable Twitch channel ID.
- Show the resolved Twitch display name to the host for confirmation before creating the invite.
- Generate a cryptographically random six-character uppercase alphanumeric code, such as `H5KO2J`, using the characters `A-Z` and `0-9`.
- Normalize entered codes to uppercase before lookup so they are case-insensitive.
- Expire the invite exactly 20 minutes after creation.
- Require the accepting JWT to have the exact `broadcaster` role and a `channel_id` matching the bound collaborator.
- Consume the code atomically in the same transaction that creates membership.
- Clear or delete the stored code immediately after it is consumed, revoked, or expires.
- Revoke previous outstanding codes when a replacement is generated.
- Apply distributed rate limits keyed primarily by authenticated channel ID.
- Return a generic invalid-or-expired response.
- Exclude codes and code-bearing request data from logs.

The collaboration membership may remain active for the full stream. The 20-minute limit applies only to accepting the invitation; the code has no purpose after the collaborator joins.

### 3. Implement safe invitee departure by splitting the queue

**Severity: High**

When the invitee leaves, the host keeps the canonical queue and it becomes a normal standalone host queue. Active entries and key offers submitted through the invitee's channel return to the invitee's standalone queue instead of being deleted.

This split is deterministic for the two-channel MVP because:

- Every entry and offer records the channel through which it was submitted.
- The invitee's standalone queue must be empty before joining.
- Standalone queue mutations for the invitee remain unavailable while the collaboration is active.
- Each active record therefore has one unambiguous destination when the collaboration ends.

Move the existing records by updating their queue ownership; do not delete and recreate them. This preserves record IDs, viewer ownership, join timestamps, and character information.

The **Leave collaboration** transaction should:

1. Verify that the caller is the invitee channel's broadcaster.
2. Lock or otherwise serialize against the active collaboration membership.
3. End the invitee's membership.
4. Leave host-originated entries and offers in the host queue.
5. Move invitee-originated active entries and key offers to the invitee's standalone queue.
6. Preserve the relative order of the moved entries and renumber them starting at position 1.
7. Reset moved active entry statuses to `waiting`, because host-issued `invited` or `skipped` states should not carry into the standalone queue.
8. Normalize the remaining host queue positions.
9. Restore the invitee's previous standalone `signupsOpen` setting rather than copying the host's setting.
10. Increment both queues' revisions atomically.
11. Revoke outstanding collaboration invitations.
12. Write transfer and membership audit events that comply with the retention policy.

After commit, publish independent invalidations to both channels. The host immediately continues with its remaining standalone queue, while the invitee sees the transferred entries and offers in its restored standalone queue.

Completed entries should not be reintroduced into the invitee's visible active queue. Handle completed history under the normal retention policy and retain only the audit information that policy permits.

Viewer-facing collaboration disclosure should explain:

> If the collaboration ends, submissions made through this channel return to this channel's standalone queue.

Membership lookup and viewer submission must serialize against departure so a viewer cannot create a standalone entry while the source-attributed records are being transferred. Depending on transaction order, the submission must either join the shared queue before the split and be transferred, or join the restored standalone queue after the split.

The separate behavior for the host choosing **End collaboration** remains a product decision and must be resolved before deployment.

### 4. Choose and constrain the queue membership model

**Severity: Medium**

The existing application uses `principal.channelId` as both the authenticated Twitch boundary and the queue storage identity. Shared queues require those concepts to remain separate.

Repository and authorization code should operate with an explicit context equivalent to:

```ts
interface QueueAccessContext {
  authenticatedChannelId: string;
  canonicalQueueId: string;
  sourceChannelId: string;
  membershipRole: "host" | "collaborator" | "standalone";
}
```

Never replace or mutate `principal.channelId` with the host channel ID.

A normalized `SharedQueue` and `SharedQueueMember` model is preferable to a single row containing host and collaborator columns. It makes it possible to enforce that a channel has only one active membership regardless of its role. Required database guarantees include:

- One active membership per channel.
- One active host per shared queue.
- At most one active collaborator for the MVP.
- A channel cannot collaborate with itself.
- Invite consumption and membership creation are atomic.
- Source-channel attribution is backfilled for existing entries and offers.

If the host channel remains the canonical queue identity for the MVP, document the resulting ownership limitation and still use a separate access context throughout the code.

### 5. Separate PubSub recipient identity from queue identity

**Severity: Medium**

The current PubSub publisher signs and sends only for `queue.channelId`, and the frontend accepts an event only when that channel matches its current Twitch authorization. A shared queue needs one publish per participating channel.

The event contract should distinguish:

- `recipientChannelId`, which must match the current Twitch channel and PubSub JWT.
- The shared queue revision.
- An optional non-authoritative queue identifier.

After a successful database commit, publish independently to the host and collaborator channels. Log and monitor each failure separately. The existing polling remains the fallback.

Do not expose numeric viewer Twitch IDs in the event or queue response.

### 6. Define trusted broadcaster display-name resolution

**Severity: Medium**

The JWT proves numeric channel identity but does not provide the trusted streamer display names needed for the join confirmation and shared-queue banner.

Specify how the EBS resolves, validates, caches, refreshes, and stores broadcaster display names. Do not accept a frontend-supplied name as authoritative. Define the fallback UI when Twitch name resolution is unavailable.

### 7. Implement Live Config as a distinct application surface

**Severity: Low**

The existing React application does not distinguish viewer and Live Config routes. Add an explicit Live Config entry point or route that renders broadcaster-only collaboration controls and does not expose viewer queue actions.

The EBS remains authoritative: Live Config should never use Twitch broadcaster configuration as the collaboration membership or share-code store.

## Additional Data and Authorization Requirements

Source attribution needs two distinct meanings:

- `submittedViaChannelId` on entries and offers.
- `actorChannelId` on audit events and moderation actions.

These should not be collapsed into one ambiguous `sourceChannelId` field.

Every shared-queue mutation must verify both conditions server-side:

1. The JWT role is authorized for the action in the caller's authenticated Twitch channel.
2. That authenticated channel has an active membership in the canonical queue.

Broadcaster-only collaboration endpoints must check `principal.role === "broadcaster"` exactly. They must not reuse the broader moderator-or-broadcaster queue-manager helper.

Membership resolution and authorization should occur within the same transaction or locking boundary as destructive mutations so that a channel cannot mutate a queue while its collaboration is concurrently ending.

## Minimum Test Gates

In addition to the tests listed in `NEXT_STEPS.md`, require coverage for:

- Two mutations attempting to use the same queue revision.
- Two mutations created within the same millisecond.
- A channel racing to join two different collaborations.
- The host and collaborator attempting to end or leave simultaneously.
- A viewer submitting while membership termination is in progress.
- Invitee departure moving only invitee-originated active entries and offers.
- Preservation of moved record IDs, ownership, timestamps, and relative ordering.
- Resetting moved active statuses to `waiting` and normalizing both queues.
- Restoration of the invitee's standalone settings.
- Host termination with collaborator-originated active content once that separate policy is finalized.
- Intended-collaborator binding, random code lookup, 20-minute expiration, replacement, reuse prevention, and log redaction.
- Rate limiting across multiple EBS instances or a shared backing store.
- PubSub fan-out where one channel succeeds and the other fails.
- Existing standalone queue behavior after all additive migrations are deployed.

## Recommended Implementation Order

1. Finalize lifecycle decisions.
2. Define the shared queue, membership, invite, attribution, and monotonic revision schema.
3. Add additive migrations and backfill source attribution.
4. Introduce queue access resolution without changing standalone behavior.
5. Add broadcaster-only invitation and membership endpoints.
6. Add transactional leave/end behavior.
7. Add PubSub fan-out and the revised event contract.
8. Add the Live Config and shared viewer disclosure UI.
9. Validate in Local Test and Hosted Test with two broadcaster accounts before Twitch review.

## Overall Assessment

The feature has strong product value and is compatible with Twitch's Live Config and channel-scoped Extension PubSub model. The current proposal is a good starting point, but it is not yet implementation- or deployment-ready.

Resolve the concurrency token, share-code construction, membership schema, and termination behavior before coding the feature. A realistic implementation estimate is approximately two to three engineering weeks for one developer, excluding Twitch review time.

Official Twitch references:

- [Extensions and Live Config](https://dev.twitch.tv/docs/extensions/)
- [Extensions Reference](https://dev.twitch.tv/docs/extensions/reference/)
- [Send Extension PubSub Message](https://dev.twitch.tv/docs/api/reference/#send-extension-pubsub-message)
- [Extension Life Cycle](https://dev.twitch.tv/docs/extensions/life-cycle/)
