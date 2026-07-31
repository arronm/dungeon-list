# Shared Collaboration Queue

## Evaluation

Allowing two streamers to share one viewer queue is a strong fit for collaboration streams and is compatible with Twitch Extensions. Twitch Live Config is the right place for streamers to create, join, inspect, and end a collaboration while live.

The recommended design is one canonical queue shared by two Twitch channels. Two independent queues should not be synchronized because doing so creates avoidable ordering, deduplication, ownership, and conflict problems.

```text
Channel A viewers ─┐
                   ├── EBS membership lookup ── Canonical shared queue
Channel B viewers ─┘
                          │
                          └── PubSub invalidation to both channels
```

Overall assessment:

| Area | Assessment |
| --- | --- |
| Product value | High for collaboration streams |
| Twitch compatibility | Supported |
| Implementation complexity | Medium-high |
| Security risk | Manageable with server-side authorization |
| Deployment risk | Moderate, primarily data migration and concurrency |

## Recommended MVP

The first release should support:

- Exactly two participating Twitch channels.
- One host-owned canonical queue.
- A short-lived, one-time share code.
- Broadcaster-only collaboration creation, joining, leaving, and termination.
- Joining only when the collaborator's existing queue is empty.
- Queue management by both broadcasters.
- Individual entry moderation by moderators from both channels.
- A shared-queue banner and source-channel attribution.
- PubSub invalidation fan-out to both channels, with polling as fallback.
- Safe collaboration termination that does not leave inaccessible viewer entries.

The first release should not support:

- Merging two non-empty queues.
- More than two channels.
- Host ownership transfer.
- Persistent streamer teams.
- Multiple simultaneous queue memberships for one channel.
- Automatic collaboration discovery.

## Live Config

The Live Config page should be the control surface for the feature. It should provide:

- **Share my queue** for the host.
- A temporary share code and expiration time.
- **Join with code** for the collaborator.
- A confirmation showing the host channel before joining.
- Current collaboration status.
- **Leave shared queue** for the collaborator.
- **End shared queue** and code revocation for the host.

Live Config is only the UI. Collaboration membership and authorization must be stored and enforced by the EBS.

Do not store an active share code in Twitch's broadcaster configuration segment. Broadcaster configuration is delivered to Extension views on that channel and should not be treated as secret or as the authority for cross-channel access.

No additional Twitch OAuth grant should be required. The verified Extension JWT already establishes the current channel and the user's Twitch role. Collaboration-management endpoints must require the exact `broadcaster` role rather than the existing broader queue-manager permission, which also permits moderators.

References:

- [Twitch Live Config](https://dev.twitch.tv/docs/extensions/life-cycle/)
- [Twitch Extension JWT and helper reference](https://dev.twitch.tv/docs/extensions/reference/)
- [Twitch Configuration Service](https://dev.twitch.tv/docs/extensions/building/#configuration-service)

## Current Architecture Impact

The current backend treats the Twitch channel ID as both:

1. The authenticated channel boundary.
2. The queue's storage identity.

Queue entries, key offers, settings, events, revisions, and viewer preferences are currently scoped directly by `principal.channelId`.

A shared queue requires these concepts to be separated:

```text
authenticatedChannelId  = channel from the verified Twitch JWT
queueOwnerChannelId     = canonical queue selected through membership
sourceChannelId         = channel through which an entry or action originated
```

The authenticated channel ID must never be overwritten with the host channel ID. It remains necessary for authorization, auditing, PubSub delivery, and safe collaboration removal.

For the two-channel MVP, the existing host channel can remain the canonical queue identity. The EBS should resolve the requesting channel to that canonical ID before queue reads and mutations. This is less disruptive than immediately introducing a generalized workspace system while leaving room for a future migration if multi-channel groups are added.

## Suggested Server-Side Records

Exact naming can be selected during implementation, but the model needs the equivalent of:

### Shared queue membership

- Canonical/host channel ID.
- Collaborator channel ID.
- Membership role (`host` or `collaborator`).
- Created and joined timestamps.
- Active/ended state.
- Unique constraint preventing a channel from joining multiple active collaborations.

### Shared queue invite

- Invite ID.
- Host channel ID.
- Hash of the share code.
- Expiration timestamp.
- Consumed timestamp and consuming channel ID.
- Revoked timestamp.
- Optional expected collaborator channel ID.

### Source attribution

Queue entries, key offers, and audit events should retain the channel through which they were submitted or performed. This is required to:

- Explain the shared queue to streamers.
- Distinguish collaborator viewer entries during termination.
- Audit actions by moderators from either channel.
- Avoid leaving inaccessible viewer entries behind.

Viewer signup preferences can remain scoped to the viewer's current channel so collaboration does not unexpectedly replace their normal per-channel defaults.

## Join Flow

1. The host opens Live Config and selects **Share my queue**.
2. The EBS verifies a Twitch Extension JWT with:
   - `role === "broadcaster"`
   - `channel_id === host channel`
3. The EBS creates a one-time invitation and returns a display code.
4. The collaborator opens Live Config on their own channel and enters the code.
5. The EBS verifies that they are the broadcaster of the collaborator channel.
6. The EBS resolves the invitation and returns a host-channel preview.
7. The collaborator confirms joining.
8. In one database transaction, the EBS verifies:
   - The invitation is active and unused.
   - The channels are different.
   - Neither channel is already in another active collaboration.
   - The collaborator's queue has no entries or key offers.
   - The collaboration still has capacity.
9. The EBS consumes the invitation and creates the membership.
10. Both channel views refresh and display the shared-queue state.

If the host wants additional protection, invitations can be bound to an expected collaborator channel. This prevents a leaked code from being consumed by another broadcaster.

## Authorization

Recommended permissions:

| Action | Host broadcaster | Collaborator broadcaster | Either channel's moderators |
| --- | --- | --- | --- |
| Create/revoke invite | Yes | No | No |
| Join collaboration | N/A | Yes | No |
| Leave collaboration | N/A | Yes | No |
| End collaboration | Yes | No | No |
| Open/close signups | Yes | Yes | Optional |
| Move/status/remove entry | Yes | Yes | Yes |
| Remove key offer | Yes | Yes | Yes |
| Clear the entire queue | Yes | No | No |

The EBS must authorize management in two stages:

1. Verify the caller's Twitch role for their authenticated channel.
2. Verify that their authenticated channel is an active member of the canonical queue.

Possession of a queue ID, host channel ID, or frontend configuration value must never grant access.

## Existing Queue Behavior

The MVP should not merge queues.

- The host may share their existing queue, including its entries and offers.
- The collaborator must have an empty queue before joining.
- If the collaborator has content, Live Config should explain that it must be completed or cleared first.
- The join operation must recheck emptiness inside the same transaction that creates membership.

This avoids unclear decisions about:

- Position order between queues.
- Duplicate viewers.
- Conflicting signup-open settings.
- Duplicate key offers.
- Completed history.
- Which streamer owns imported content.

## Leaving and Ending

Disconnect behavior must be explicit because viewers from the departing channel may otherwise lose the ability to leave or remove their offers.

Recommended behavior:

- Do not silently detach a channel with active source-channel entries or offers.
- Show the number of affected entries and offers before confirmation.
- Allow the collaborator to:
  - Resolve their channel's active content first, or
  - Explicitly remove content submitted through their channel and leave.
- Preserve an audit record of removed content without keeping it visible in the active queue.
- The host retains their canonical queue after the collaboration ends.
- Revoke all outstanding invitations when the collaboration ends.

Completed history originating from the collaborator should have a documented retention rule. The simplest privacy-preserving MVP behavior is to remove it from the visible queue when the collaborator leaves while retaining only the existing internal audit metadata.

## Viewer Experience

Both viewer surfaces should clearly disclose the collaboration before submission:

> Shared queue for Streamer A and Streamer B. Entries submitted here are visible and manageable on both channels.

Recommended UI additions:

- Shared-queue banner with both channel display names.
- Source-channel badge on entries and offers for managers.
- Confirmation when a viewer who already joined through the other channel attempts to join again.
- A single active entry per Twitch user across the shared queue.
- Key-offer deduplication across the shared queue.

Because linked Twitch user IDs are stable, a viewer visiting both channels should see the same active entry and should be able to leave it from either channel while the collaboration remains active.

The privacy policy and Extension description should disclose that Twitch usernames and submitted character/key information may be displayed and moderated on both participating channels.

## Realtime Updates

Twitch Extension PubSub broadcasts are scoped to an Extension and broadcaster channel. A mutation to a shared queue therefore requires a separate invalidation publish to each participating channel.

For each mutation:

1. Commit the canonical queue transaction.
2. Generate the queue revision.
3. Publish a compact invalidation to the host channel.
4. Publish the same revision to the collaborator channel.
5. Log delivery failures independently.

Each publish must use a valid external JWT for the recipient channel, and its `broadcaster_id` must match that channel.

The existing 15-second polling remains the fallback if one PubSub publish fails. The frontend event check must validate the recipient channel or shared queue identifier without confusing the canonical host ID with the current Twitch channel ID.

Reference:

- [Send Extension PubSub Message](https://dev.twitch.tv/docs/api/reference/#send-extension-pubsub-message)

## Concurrency

Two broadcasters and two moderation teams make concurrent queue operations substantially more likely.

Potential conflicts include:

- Two users moving the same entry.
- Two users swapping adjacent entries at the same time.
- Clearing while another manager updates an entry.
- Closing signups while a viewer joins.
- Ending a collaboration while a viewer submits.
- Two broadcasters consuming or replacing invitations concurrently.

Recommended safeguards:

- Include the last observed queue revision in management mutations.
- Return a conflict response when a mutation is based on a stale revision.
- Refresh the queue automatically after a conflict.
- Use serializable transactions or explicit database locking for membership changes, invitations, destructive queue operations, and position reordering.
- Add database uniqueness constraints for active memberships and one-time invite consumption.

## Share-Code Security

Share codes should be:

- Generated from cryptographically secure randomness.
- Short enough to type but sufficiently high entropy.
- Stored only as a one-way hash.
- Single-use.
- Valid for approximately 10 minutes.
- Revoked when a replacement is generated.
- Rate-limited by authenticated channel and network source.
- Excluded from request and application logs.

Code-entry responses should not reveal whether a code exists until appropriate rate-limit checks are applied. Repeated failures should produce a generic invalid-or-expired response.

## Twitch Review and Deployment

This feature changes the Extension frontend and Live Config experience, so it should be included in a new Hosted Test version and Twitch review submission.

The review walkthrough should include:

- Two broadcaster testing accounts.
- Creating and consuming a share code.
- Viewer submission from each channel.
- Moderation from each broadcaster.
- PubSub/polling synchronization.
- Leaving and ending the collaboration.
- Behavior when the collaborator already has a non-empty queue.
- Invalid, expired, reused, and revoked codes.

Both broadcaster accounts must be included in the appropriate Twitch testing allowlist.

The EBS must continue to support the previous released frontend during rollout. Twitch notes that viewers may still have an older Extension version loaded when a new version is released.

Recommended deployment sequence:

1. Apply additive database changes.
2. Deploy an EBS that preserves existing standalone queue behavior.
3. Validate standalone queues before enabling collaboration.
4. Upload and test the new Extension assets in Hosted Test.
5. Test with two broadcaster accounts.
6. Submit the new version for Twitch review.
7. Release the reviewed assets.
8. Monitor membership, invite, authorization, PubSub, and conflict errors.

Reference:

- [Twitch Extension life cycle](https://dev.twitch.tv/docs/extensions/life-cycle/)

## Test Coverage

Required backend tests:

- Only broadcasters can create, join, leave, or end collaboration.
- A moderator cannot connect channels.
- A viewer cannot consume a code.
- A code is single-use, expiring, revocable, and stored hashed.
- A channel cannot join itself.
- A channel cannot belong to multiple active collaborations.
- The collaborator cannot join with a non-empty queue.
- Viewers from both channels read and mutate the same canonical queue.
- Active-entry uniqueness applies across both channels.
- Offer deduplication applies across both channels.
- Managers cannot access a queue unless their channel is a member.
- Collaboration removal safely handles source-channel content.
- Concurrent joins and invitation consumption remain consistent.
- Queue events retain actor and source-channel attribution.

Required frontend tests:

- Live Config renders only collaboration controls.
- Host, collaborator, and inactive states render correctly.
- Join preview requires explicit confirmation.
- Invalid and expired codes show safe errors.
- Shared-queue disclosure appears in both viewer contexts.
- PubSub events for either member channel refresh the queue.
- Stale mutation conflicts refresh without losing the current UI state.

Required Twitch integration tests:

- Live Config and its pop-out load correctly.
- Both channels receive realtime invalidations.
- Broadcaster and moderator JWT roles behave as expected.
- The flow works in Local Test and Hosted Test.

## Decisions to Confirm Before Implementation

The recommended defaults are:

1. The host owns the canonical queue.
2. The collaborator's queue must be empty before joining.
3. Only broadcasters can connect or disconnect channels.
4. Moderators from both channels can manage individual entries.
5. Only the host broadcaster can clear the entire queue.
6. A collaborator cannot leave while their channel has active content unless they explicitly remove it.
7. Shared queues support exactly two channels.
8. Codes are one-time and expire after 10 minutes.
9. Viewer-facing UI identifies the collaboration before submission.

If future requirements include three or more streamers, ownership transfer, persistent teams, or queue merging, the data model should move from a host-channel canonical ID to a first-class queue workspace.
