# Solar House — VK cloud publisher (disabled by default)

## Актуальный режим с 19 ноября 2026

**Только статьи с изображениями для стены сообщества.** Автоматическая
публикация клипов и историй отключена; видео владелец снимает и размещает
самостоятельно. Первый недельный статический пакет (20, 22, 24, 26 ноября)
ожидает согласования:
`review/week-2026-11-20_26/articles-only.md`.

Видеоэксперименты и команды восстановления ниже оставлены исключительно
для истории. `Stage-VK-Video.ps1 -Upload` и
`Recover-VK-Terrace-Clip.ps1 -Publish` **не запускать**.

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
- Новый пакет статей не утверждён и отсутствует в рабочей `queue/`;
  ранее опубликованные записи и журналы сохранены.

## Test without posting

1. GitHub → Actions → `Solar House VK — cloud publisher (PC may be off)`.
2. `Run workflow` → mode `preview`.
3. Confirm `VK_GROUP_TOKEN: configured`, `Live publication switch: disabled`,
   and tests passing. No VK API request is made in preview.

## Later: preparing and scheduling posts

Each *explicitly approved* post can be stored as a JSON object under `queue/`.
The text and schedule will be publicly visible before the scheduled time;
**do not place private drafts or confidential client information in this repo**.

The Windows staging stage runs from the owner's interactive Windows session. It
uploads the approved image to the community photo album ahead of time and
records its verified `photo_attachment`, image hash, and content hash in the
queue. It **does not post to the wall**. The Windows computer can then be off.

### One-time Windows setup (no GitHub CLI)

Git for Windows, Node.js 22+, Chrome and the existing `SolarHouseVkAuto`
Playwright profile are prerequisites. In an ordinary (non-administrator)
PowerShell session, clone the repository once under the existing working folder:

```powershell
git clone https://github.com/Nikest20/solar-house-vk-feed.git "$env:USERPROFILE\SolarHouseVK\publisher-cloud"
& "$env:USERPROFILE\SolarHouseVK\publisher-cloud\Setup-VK-Staging.ps1"
```

The setup checks local prerequisites, reads the queue in preview, and checks
GitHub write access using `git push --dry-run` (may open browser auth). It then
registers a user-session Scheduled Task for login and hourly staging, **disabled
by default**. It never uploads a photo or posts to the wall while installing.

After a separate approval, enable photo staging:

```powershell
& "$env:USERPROFILE\SolarHouseVK\publisher-cloud\Enable-VK-Staging.ps1"
```

To stop photo staging without touching the wall publisher:

```powershell
& "$env:USERPROFILE\SolarHouseVK\publisher-cloud\Disable-VK-Staging.ps1"
```

The task runs only when that user is signed in, not through the old
`NETWORK SERVICE` GitHub Runner. It first does a fast-forward Git pull, and
when approved images are present under `media/`, it stages at most 3 per run.
Uploaded photo IDs are committed and pushed to GitHub. Any uncertain outcome
requires manual review instead of an automatic duplicate upload.

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

## Пропущенный клип 19 ноября — одноразовое восстановление

После `Inspect-VK-Clip-Draft.ps1`, если отчёт подтверждает отсутствие
публикации и отложенного клипа, можно запустить
`Recover-VK-Terrace-Clip.ps1` (проверка без изменений). Режим
`Recover-VK-Terrace-Clip.ps1 -Publish` **один раз** загружает тот же
одобренный MP4, заполняет подпись, публикует клип и сохраняет снимки
и журнал в `%LOCALAPPDATA%\SolarHouseVkAuto\video-staging\`.

Не запускать `-Publish` второй раз и не удалять журналы при ошибках.
Сверить итоговый клип, его появление на главной сообщества и историю:
VK Видео, стена сообщества и история не являются одной гарантированной
операцией. Остальные ролики пока требуют отдельной приёмки.
