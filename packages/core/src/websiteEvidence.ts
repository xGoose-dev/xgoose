/** Model-only projection. The original tool result stays in history/transcripts. */
export function websiteEvidence(result: unknown, origin: string): unknown {
  if (!result || typeof result !== 'object') return result;
  const raw = result as Record<string, any>;
  if (!raw.topic_list || !Array.isArray(raw.topic_list.topics)) return result;
  const topics = raw.topic_list.topics;
  if (!topics.every((topic: any) => topic && Number.isSafeInteger(topic.id) && typeof topic.title === 'string')) return result;
  const fields = ['id', 'title', 'slug', 'created_at', 'last_posted_at', 'bumped_at',
    'posts_count', 'reply_count', 'views', 'like_count', 'category_id', 'tags', 'pinned', 'closed', 'archived'];
  return {
    origin,
    topic_list: {
      per_page: raw.topic_list.per_page,
      more_topics_url: raw.topic_list.more_topics_url,
      topics: topics.map((topic: any) => ({
        ...Object.fromEntries(fields.filter(field => topic[field] !== undefined).map(field => [field, topic[field]])),
        url: `${origin}/t/${topic.id}`,
        ...(Number.isSafeInteger(topic.posts_count) && topic.posts_count >= 1 ? {total_replies: topic.posts_count - 1} : {}),
      })),
    },
    returned: topics.length,
    coverage: 'topic_list_page',
    count_semantics: 'total_replies = posts_count - 1 (excluding the original post). Discourse reply_count counts direct reply relationships, not all topic replies.',
  };
}
