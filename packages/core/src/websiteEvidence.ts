const isForumPost = (post: any) => post && Number.isSafeInteger(post.post_number) && typeof post.text === 'string';

const POST_FORMAT = '#floor @user [date, shown when it changes] [♥likes] [↩@user#floor it replies to, omitted when that is the floor on the line directly above]: text with [quote @user #floor: quoted text]';
const TOPIC_FORMAT = '#id title · replies · views · ♥likes · created→last post · [tags] · flags';
/** Thread fields the post lines, `complete` and `next_cursor` already convey. */
const DERIVABLE = new Set(['id', 'origin', 'first_post_number', 'last_post_number', 'requested_from_post_number', 'selected_count', 'text_complete', 'range_complete', 'hint']);

const day = (value: unknown) => typeof value === 'string' ? value.slice(0, 10) : '';

function postLines(posts: any[]): string[] {
  let lastDay = '', lastFloor: number | undefined;
  return posts.map(post => {
    const date = day(post.created_at), parts = [`#${post.post_number}`];
    if (post.username) parts.push(`@${post.username}`);
    if (date && date !== lastDay) parts.push(date);
    if (post.like_count) parts.push(`♥${post.like_count}`);
    const repliesToLineAbove = post.reply_to_post_number === lastFloor && lastFloor === post.post_number - 1;
    if (post.reply_to_post_number && !repliesToLineAbove) parts.push(`↩${post.reply_to_username ? `@${post.reply_to_username}` : ''}#${post.reply_to_post_number}`);
    lastDay = date || lastDay; lastFloor = post.post_number;
    const more = !post.text_truncated ? '' :
      post.next_text_offset != null ? ` …[continues at text_offset ${post.next_text_offset}]` : ' …[truncated]';
    return `${parts.join(' ')}: ${post.text}${more}`;
  });
}

function withoutNoise(raw: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) =>
    value !== null && value !== undefined && !(Array.isArray(value) && !value.length) && !DERIVABLE.has(key) &&
    !(key === 'status' && value === 'ok') && !(key === 'output_limited' && value === false)));
}

/** One line per post; post links are `${url}/${floor}`. */
function compactThread(raw: Record<string, any>): Record<string, any> {
  if (!Array.isArray(raw.posts) || !raw.posts.length || !raw.posts.every(isForumPost)) return raw;
  const url = typeof raw.url === 'string' ? raw.url : String(raw.posts[0].url ?? '').replace(/\/\d+$/, '');
  return {...withoutNoise(raw), ...(raw.hint ? {hint: raw.hint} : {}), url, post_url: `${url}/{floor}`, post_format: POST_FORMAT, posts: postLines(raw.posts)};
}

function topicLine(topic: any): string {
  const parts = [`#${topic.id} ${topic.title}`];
  if (Number.isSafeInteger(topic.posts_count) && topic.posts_count >= 1) parts.push(`${topic.posts_count - 1} replies`);
  if (topic.views) parts.push(`${topic.views} views`);
  if (topic.like_count) parts.push(`♥${topic.like_count}`);
  const created = day(topic.created_at), last = day(topic.last_posted_at ?? topic.bumped_at);
  if (created || last) parts.push(last && last !== created ? `${created}→${last}` : created || last);
  const tags = Array.isArray(topic.tags) ? topic.tags.map((tag: any) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean) : [];
  if (tags.length) parts.push(`[${tags.join(', ')}]`);
  const flags = ['pinned', 'closed', 'archived'].filter(flag => topic[flag]);
  if (flags.length) parts.push(flags.join(' '));
  return parts.join(' · ');
}

const isSearchHit = (post: any) => post && Number.isSafeInteger(post.topic_id) && Number.isSafeInteger(post.post_number) && typeof post.blurb === 'string';
const isTopic = (topic: any) => topic && Number.isSafeInteger(topic.id) && typeof topic.title === 'string';

/** Search hits as `#topic/floor @user date ♥likes: snippet`; topics as topic lines. */
function compactSearch(raw: Record<string, any>, origin: string): Record<string, any> {
  const more = raw.grouped_search_result?.more_full_page_results || raw.grouped_search_result?.more_posts;
  const {grouped_search_result, total_topics, total_posts, topics, posts, ...rest} = raw;
  return {
    ...withoutNoise(rest),
    ...(rest.hint ? {hint: rest.hint} : {}),
    topic_url: `${origin}/t/{id}`,
    post_url: `${origin}/t/{topic}/{floor}`,
    ...(topics.length ? {topic_format: TOPIC_FORMAT, topics: topics.map(topicLine)} : {}),
    ...(posts.length ? {post_format: '#topic/floor @user date [♥likes]: snippet', posts: posts.map((post: any) =>
      `#${post.topic_id}/${post.post_number}${post.username ? ` @${post.username}` : ''}${day(post.created_at) ? ` ${day(post.created_at)}` : ''}${post.like_count ? ` ♥${post.like_count}` : ''}: ${post.blurb}`)} : {}),
    ...(more ? {more_results: true} : {}),
  };
}

function compactKnown(raw: Record<string, any>, origin: string): unknown {
  if (Array.isArray(raw.posts) && Array.isArray(raw.topics) && raw.posts.every(isSearchHit) && raw.topics.every(isTopic)) return compactSearch(raw, origin);
  if (Array.isArray(raw.posts)) return compactThread(raw);
  if (Array.isArray(raw.topics) && raw.topics.some((topic: any) => Array.isArray(topic?.posts)))
    return {...raw, topics: raw.topics.map((topic: any) => topic && Array.isArray(topic.posts) ? compactThread(topic) : topic)};
  if (!raw.topic_list || !Array.isArray(raw.topic_list.topics) || !raw.topic_list.topics.every(isTopic)) return raw;
  return {
    topic_url: `${origin}/t/{id}`,
    ...(raw.topic_list.more_topics_url ? {more_topics_url: raw.topic_list.more_topics_url} : {}),
    topic_format: TOPIC_FORMAT,
    topics: raw.topic_list.topics.map(topicLine),
  };
}

/** How far into arrays, Promise.allSettled entries and combined objects skill results are recognised. */
const MAX_DEPTH = 4;

/** Model-only projection. The original tool result stays in history/transcripts. */
export function websiteEvidence(result: unknown, origin: string, depth = 0): unknown {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return depth < MAX_DEPTH ? result.map(item => websiteEvidence(item, origin, depth + 1)) : result;
  const raw = result as Record<string, any>, compact = compactKnown(raw, origin);
  if (compact !== raw || depth >= MAX_DEPTH) return compact;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, websiteEvidence(value, origin, depth + 1)]));
}
