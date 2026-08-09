# Shared Collaboration Queue Rollback

Use a revert commit to roll back a production deployment. Do not reset or
force-push `main`.

## Before merging

Create a recovery tag at the current production commit and push it before
updating `main`:

```bash
git fetch origin
git tag -a pre-shared-collab-queue origin/main -m "Before shared collaboration queue"
git push origin pre-shared-collab-queue
```

Merge the feature with a normal merge commit and record the merge commit SHA.

## Roll back through a protected branch

Create a rollback branch from the deployed `main`:

```bash
git fetch origin
git switch -c revert/shared-collab-queue origin/main
git revert -m 1 <merge-commit-sha>
git push -u origin revert/shared-collab-queue
```

Open and merge the rollback pull request. Render should deploy the resulting
revert commit automatically.

## Roll back directly on main

Use this only when direct pushes to `main` are permitted:

```bash
git switch main
git pull --ff-only origin main
git revert -m 1 <merge-commit-sha>
git push origin main
```

The `-m 1` option applies to a normal merge commit. If the feature was squash
merged into one ordinary commit, use `git revert <squash-commit-sha>` instead.

## Database handling

The collaboration migration is additive. It adds and backfills columns and
creates new tables, indexes, constraints, and an enum. Leave the migration
applied during an application rollback; do not manually drop these database
objects. A corrected release should deploy forward with another migration if
the schema needs to change.

Do not begin a real collaboration until production smoke testing succeeds. If
a collaboration is active and the EBS is still operational, end it before
rolling back so collaborator-originated records are split back to their source
queue cleanly.

## Verification

After Render deploys either the feature or its rollback:

1. Confirm the Render deployment completed and its migration step succeeded.
2. Confirm the EBS health endpoint responds successfully.
3. Load a standalone queue and verify reads and moderation still work.
4. For the feature deployment, test invite, join, moderation, and split using
   Twitch Local Test before publishing new Extension assets.
