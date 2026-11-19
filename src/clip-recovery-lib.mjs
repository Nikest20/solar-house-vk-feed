// Recovery is a separately authorised, one-shot operation after a failed
// *first* upload. It does not reset or erase the original attempt journal.
export function verifyTerraceRecoveryEvidence({ originalJournal, originalResult, inspection, expectedSha }) {
  if (originalJournal.video_id !== 'solar-house-terrace-20261119' ||
      originalJournal.file_sha256 !== expectedSha ||
      originalJournal.state !== 'upload-outcome-uncertain') {
    throw new Error('First upload journal does not match the approved clip');
  }
  if (originalResult.video_id !== originalJournal.video_id ||
      originalResult.file_sha256 !== expectedSha ||
      !originalResult.selected_file_once ||
      originalResult.clicked_publish || originalResult.clicked_save || originalResult.clicked_next) {
    throw new Error('First upload state has changed: stop and review manually');
  }
  if (inspection.mode !== 'READ-ONLY' ||
      inspection.clip_id !== 'clip-211038294_456239559' ||
      inspection.publication_status !== 'not-confirmed' || inspection.error) {
    throw new Error('Read-only VK inspection is missing or inconsistent');
  }
  const views = Object.fromEntries((inspection.views ?? []).map(view => [view.name, view]));
  for (const name of ['cabinet', 'clips', 'clips-filter', 'direct-clip-link']) {
    if (!views[name] || views[name].clip_id_in_dom || views[name].matching_clip_links) {
      throw new Error(`${name}: VK inspection missing or found the original clip; no repeat allowed`);
    }
  }
  if (!/0\s*клипов/i.test(views['clips-filter'].content_excerpt ?? '')) {
    throw new Error('Scheduled clips are not confirmed empty');
  }
  // VK abbreviates dates inside the Clips table ("17 нояб 2026") but writes
  // the full month on its Overview card ("17 ноября 2026"). Both are valid.
  if (!/17\s*нояб(?:ря)?\s*2026/i.test(views.clips.content_excerpt ?? '') ||
      /Терраса\? Да зачем она нам/i.test(views.clips.content_excerpt ?? '')) {
    throw new Error('Published clips listing does not match the inspected state');
  }
  return { originalClipId: inspection.clip_id, previouslyScheduled: 0 };
}

// VK Video uses NBSP around many Russian words in the creator editor. Text
// returned by Playwright.innerText() preserves some of those NBSP characters,
// even though getByText() treats them as regular spaces.
export function parsePreparedClipEditor(rawText, filename, previousClipId) {
  const labels = String(rawText).replace(/\s+/gu, ' ').trim();
  const required = [
    'Клип загружен и обработан', filename, 'Сейчас',
    'Показать на главной сообщества', 'Опубликовать в истории',
  ];
  const missing = required.filter(value => !labels.includes(value));
  if (missing.length) throw new Error(`Clip editor is missing: ${missing.join(', ')}`);
  const match = labels.match(/https:\/\/vkvideo\.ru\/(clip-211038294_\d{5,})/);
  if (!match || match[1] === previousClipId) {
    throw new Error('No NEW community-owned VK Clip ID; stop without publishing');
  }
  return { id: match[1], url: match[0] };
}
