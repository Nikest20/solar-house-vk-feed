# Solar House VK — approved video queue

The scheduled GitHub Actions workflow `.github/workflows/vk-videos-cloud.yml`
publishes only **already-uploaded** community videos. The approved MP4 is
prepared in advance from the owner's signed-in Windows Chrome, just as photo
staging uses that browser. The community video ID is then checked, pinned in
the queue, and the publisher posts it to the wall only after `publish_at`.
Browser staging may start **as soon as a video is approved**; there is no
separate calendar restriction on uploading drafts. The scheduled wall
publication time remains independent.

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

`Inspect-VK-Video-Staging.ps1` records the video upload controls without
choosing a file. `Stage-VK-Video.ps1` runs a read-only queue/hash check;
`Stage-VK-Video.ps1 -Upload` selects the approved MP4 **once**, captures the
next screen locally, and does not click Next/Save/Publish. The one-shot
browser uploader is still being verified; it does not yet populate the VK
community attachment ID in the queue or enable cloud wall posting.

VK `video.save` creates a **video**, not necessarily an entry in the separate
VK **Clips** feed. GitHub Actions schedules may lag the requested minute.
