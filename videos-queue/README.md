# Solar House VK — approved video queue

The scheduled GitHub Actions workflow `.github/workflows/vk-videos-cloud.yml`
publishes only **already-uploaded** community videos. The approved MP4 is
prepared in advance from the owner's signed-in Windows Chrome, just as photo
staging uses that browser. The community video ID is then checked, pinned in
the queue, and the publisher posts it to the wall only after `publish_at`.

**Disabled until explicitly configured:**

- GitHub Actions **Variable** `VK_VIDEO_ENABLED=true` (separate opt-in).
- Existing `VK_PUBLISH_ENABLED=true` and `VK_GROUP_TOKEN` are required; no
  **user** token is needed by this cloud publisher.
- Verify in `Actions > Solar House VK — cloud video staging and publication`
  by running `preview` before enabling the new switch.

The public repo stores the approved MP4 and caption. Do not place confidential
client media or access tokens here. The browser upload needs a local one-shot
ledger and pre-post check; **the browser implementation must be verified on
the owner's real VK UI before staging is enabled**. Every cloud wall.post is
preceded by a GitHub commit to `cloud-video-state/`. Any uncertain outcome
stays blocked: manually reconcile VK and the journal before proceeding.

First run on Windows after `git pull`: `Inspect-VK-Video-Staging.ps1`. It only
opens the community video page, records the available controls and screenshot
locally, and never uploads anything. Inspect the result before adding a real
video uploader.

VK `video.save` creates a **video**, not necessarily an entry in the separate
VK **Clips** feed. GitHub Actions schedules may lag the requested minute.
