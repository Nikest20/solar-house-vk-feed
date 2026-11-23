// Editorial selection for the post-only Solar House schedule. This is NOT the
// publication queue. Editorial approval may progress while this plan remains
// non-publishing; only separately approved queue/*.json posts can go live.
export function selectArticleOnlyDrafts(source, plan) {
  if (!['needs_approval', 'partially_approved', 'approved'].includes(plan.review_status)) {
    throw new Error('Unsupported article-only editorial review status');
  }
  if (plan.publication_enabled !== false ||
      plan.video_automation_enabled !== false || plan.stories_enabled !== false) {
    throw new Error('Article-only plan must remain non-publishing, without video or story automation');
  }
  if (source.review_status !== 'archived' || source.publication_enabled !== false ||
      source.superseded_by !== 'drafts/2026-11-20_26-articles-only.json') {
    throw new Error('Source material must be an archived, non-publishing plan');
  }
  if (plan.source_file !== 'drafts/2026-11-20_26-weekly.json' || !Array.isArray(plan.post_ids) ||
      plan.post_ids.length !== 4 || new Set(plan.post_ids).size !== plan.post_ids.length) {
    throw new Error('Expected four unique article references in the source week');
  }
  const byId = new Map(source.items.map(item => [item.id, item]));
  return plan.post_ids.map(id => {
    const item = byId.get(id);
    if (!item || item.format !== 'image_post' || item.status !== 'needs_approval' ||
        !/^2026-11-(20|22|24|26)T10:00:00\+03:00$/.test(item.publish_at)) {
      throw new Error(`Not an eligible unapproved static article: ${id}`);
    }
    return item;
  });
}
