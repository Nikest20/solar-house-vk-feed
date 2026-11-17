# Solar House — VK cloud publisher (disabled by default)

This repository previously hosted a test RSS feed in `feed.xml`. That obsolete
feed was removed at the owner's request. The current solution uses GitHub
Actions to publish approved and pre-staged posts directly through the VK API.

## Current setup

- VK community: `211038294`.
- Photo album: `281257058`.
- Workflow: `.github/workflows/vk-publisher-cloud.yml`.
- Secret: `VK_GROUP_TOKEN` (GitHub Actions repository secret; never commit a token).
- Kill switch: `VK_PUBLISH_ENABLED` (GitHub Actions repository **variable**).
- **Live publication is OFF until `VK_PUBLISH_ENABLED` is explicitly `true`.**
- There are no approved posts in the public queue. Draft texts and images are
  deliberately not committed to this public repository.

## Test without posting

1. GitHub → Actions → `Solar House VK — cloud publisher (PC may be off)`.
2. `Run workflow` → mode `preview`.
3. Confirm `VK_GROUP_TOKEN: configured`, `Live publication switch: disabled`,
   and tests passing. No VK API request is made in preview.

## Later: preparing and scheduling posts

Each *explicitly approved* post can be stored as a JSON object under `queue/`.
The text and schedule will be publicly visible before the scheduled time;
**do not place private drafts or confidential client information in this repo**.

The Windows staging stage runs from the interactive `MSI\\nstud` session. It
uploads the approved image to the community photo album ahead of time and
records its verified `photo_attachment`, image hash, and content hash in the
queue. It **does not post to the wall**. The Windows computer can then be off.

With `VK_PUBLISH_ENABLED=true`, scheduled GitHub-hosted Actions runs may
publish one due approved staged post per invocation. A one-shot journal is
committed and pushed under `cloud-publisher-state/` *before* VK `wall.post`.
If VK's outcome is unknown, automatic retry is blocked pending manual review.

The scheduler checks every 15 minutes (UTC 03/18/33/48), but GitHub Actions
does not guarantee execution at the exact minute. Photos not prepared while
the local PC was on cannot be published by the cloud workflow.

## Enabling live posts is a separate step

First run the preview, make sure a post was approved and the photo uploaded
in advance, and inspect the queue JSON. Only then create/set repository
variable `VK_PUBLISH_ENABLED=true` in Settings → Secrets and variables →
Actions → Variables. Do not enable the variable as part of installation.
