# Solar House VK — approved video queue

The scheduled GitHub Actions workflow `.github/workflows/vk-videos-cloud.yml` is
independent of photo staging. A `status: approved` video becomes eligible to be
uploaded after `upload_not_before`. Uploading is done **without creating a wall
post**. Only after VK returns the video ID and reports an encoded, playable video
does the publisher send the wall post after `publish_at`.

**Disabled until explicitly configured:**

- GitHub Actions **Secret** `VK_VIDEO_USER_TOKEN`: authorized VK **user** token
  (admin/editor of community 211038294) with video permissions. The existing
  community `VK_GROUP_TOKEN` cannot call `video.save` according to the official
  API schema.
- GitHub Actions **Variable** `VK_VIDEO_ENABLED=true` (separate opt-in).
- Existing `VK_PUBLISH_ENABLED=true` and `VK_GROUP_TOKEN` are also required.
- Verify in `Actions > Solar House VK — cloud video staging and publication`
  by running `preview` before enabling the new switch.

The public repo stores the approved MP4 and caption. Do not place confidential
client media or access tokens here. Every upload and wall post is preceded by
a GitHub commit to `cloud-video-state/`. Any uncertain outcome stays blocked:
manually reconcile the VK object and journal before proceeding.

VK `video.save` creates a **video**, not necessarily an entry in the separate
VK **Clips** feed. GitHub Actions schedules may lag the requested minute.
