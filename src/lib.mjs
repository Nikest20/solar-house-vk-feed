import path from 'node:path';
import crypto from 'node:crypto';

export const GROUP_ID = '211038294';
export const ALBUM_ID = '281257058';
export const GROUP_OWNER_ID = `-${GROUP_ID}`;
export const PRE_POST_STATUSES = new Set(['photo-uploaded-no-post']);
export const TERMINAL_OR_UNCERTAIN = new Set([
  'upload-attempted', 'upload-uncertain', 'post-outcome-uncertain',
  'published', 'vk-api-error', 'blocked-content-changed',
]);

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function validatePost(post, filename = '<unknown>') {
  const invalid = description => { throw new Error(`${filename}: ${description}`); };
  if (!post || typeof post !== 'object' || Array.isArray(post)) invalid('ожидался JSON-объект');
  if (typeof post.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(post.id)) {
    invalid('id: 3–64 символа, латиница в нижнем регистре, цифры, _ и -');
  }
  if (!['draft', 'approved'].includes(post.status)) invalid('status: только draft или approved');
  if (typeof post.publish_at !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(post.publish_at)) {
    invalid('publish_at: нужна дата ISO 8601 с явным часовым поясом');
  }
  const publishedAt = new Date(post.publish_at);
  if (!Number.isFinite(publishedAt.getTime())) invalid('publish_at: неверная дата');
  if (typeof post.text !== 'string' || post.text.trim().length < 8 || post.text.length > 16000) {
    invalid('text: требуется текст длиной 8–16000 символов');
  }
  if (typeof post.image !== 'string' || post.image.length > 200 ||
      post.image !== path.basename(post.image) || /[/\\:]/.test(post.image) ||
      !/\.(?:jpe?g|png|webp)$/i.test(post.image)) {
    invalid('image: только имя JPG, PNG или WEBP файла из папки media, без путей');
  }
  if (post.image === '.' || post.image === '..') invalid('image: недопустимое имя');
  return { ...post, publishedAt };
}

export function selectDuePost(posts, now = new Date()) {
  const approved = posts.filter(post => post.status === 'approved' && post.publishedAt <= now);
  approved.sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
  return approved[0] ?? null;
}

export function checkResume(state, postId, imageHash, messageHash) {
  if (!state) return { action: 'new' };
  if (state.post_id !== postId) return { action: 'block', reason: 'другая публикация в журнале' };
  if (state.image_sha256 !== imageHash || state.message_sha256 !== messageHash) {
    return { action: 'block', reason: 'после начала публикации изменились фото или текст' };
  }
  if (PRE_POST_STATUSES.has(state.status) && /^photo-211038294_\d{6,}$/.test(state.photo_attachment ?? '')) {
    return { action: 'resume', attachment: state.photo_attachment };
  }
  return { action: 'block', reason: `состояние ${state.status ?? 'неизвестно'} — автоматический повтор запрещён` };
}

export function validateUploadResult(result, expectedHash) {
  if (!result || result.status !== 'candidate-photo-id-found-needs-visual-check') {
    throw new Error('VK не подтвердил ровно одну новую фотографию');
  }
  if (result.file_sha256 !== expectedHash || !Array.isArray(result.new_photo_ids) || result.new_photo_ids.length !== 1) {
    throw new Error('отчёт не соответствует исходному файлу или содержит не один ID');
  }
  const id = result.new_photo_ids[0];
  const expectedUrl = `https://vk.ru/photo-${GROUP_ID}_${id}`;
  if (!/^\d{6,}$/.test(String(id)) || result.photo_url !== expectedUrl) {
    throw new Error('неожиданный ID фотографии в результате загрузки');
  }
  return `photo-${GROUP_ID}_${id}`;
}
