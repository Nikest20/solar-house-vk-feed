import { sha256, GROUP_ID } from './lib.mjs';

export function contentDigest(post) {
  return sha256(Buffer.from(`${post.id}\n${post.text}\n${post.image}`, 'utf8'));
}

export function preparedAttachment(post) {
  if (typeof post.photo_attachment !== 'string' ||
      !new RegExp(`^photo-${GROUP_ID}_\\d{6,}$`).test(post.photo_attachment)) {
    return { ready: false, reason: 'не получен ID фотографии сообщества' };
  }
  if (post.staged_content_sha256 !== contentDigest(post)) {
    return { ready: false, reason: 'текст или изображение изменились после подготовки фото' };
  }
  if (typeof post.staged_image_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(post.staged_image_sha256)) {
    return { ready: false, reason: 'не указан SHA-256 загруженного изображения' };
  }
  if (post.approved_image_sha256 && post.staged_image_sha256 !== post.approved_image_sha256) {
    return { ready: false, reason: 'загруженное изображение отличается от утверждённого' };
  }
  return { ready: true, attachment: post.photo_attachment };
}

export function cloudDuePosts(posts, now = new Date()) {
  return posts.filter(post => post.status === 'approved' && post.publishedAt <= now)
    .sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
}
