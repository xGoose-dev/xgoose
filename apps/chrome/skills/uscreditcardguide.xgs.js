// ==XGooseSkill==
// @name         uscreditcardguide
// @namespace    usccg
// @version      0.2.0
// @description  美国信用卡指南 (uscreditcardguide.com) blog reader. Anonymous WP REST against /wp-json/wp/v2/*.
// @match        *://www.uscreditcardguide.com/*
// @match        *://uscreditcardguide.com/*
// @detect       location.hostname.endsWith('uscreditcardguide.com')
// @run-at       document_idle
// @primary      searchPosts
// @keyword      uscreditcardguide
// @keyword      USCCG
// @keyword      信用卡指南
// @keyword      美卡
// @keyword      credit card
// ==/XGooseSkill==

/**
 * Field reference:
 *   post.title.rendered     → HTML-encoded title with entities
 *   post.excerpt.rendered   → HTML <p>...</p> with trailing "Read more" anchor
 *   post.content.rendered   → full HTML body (50-100 KB typical)
 *   post.date               → 'YYYY-MM-DDTHH:MM:SS' site-local; trimmed to YYYY-MM-DD
 */

import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';

const SUMMARY_FIELDS = 'id,slug,title,excerpt,date,link,categories';
const FULL_FIELDS = 'id,slug,title,excerpt,content,date,modified,link,categories,author';

const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&ndash;': '–',
  '&mdash;': '—',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
};

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITY_MAP[m] ?? m);
}

function stripHtml(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(s);
}

function dropReadMore(excerpt) {
  return String(excerpt ?? '')
    .replace(/<a[^>]*class="[^"]*read-more-button[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/&hellip;\s*$/, '…');
}

function toSummary(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: stripHtml(r.title?.rendered ?? ''),
    excerpt: stripHtml(dropReadMore(r.excerpt?.rendered ?? '')),
    date: normalizeDate(r.date),
    link: r.link ?? '',
    categories: r.categories ?? [],
  };
}

function toFull(r) {
  const html = r.content?.rendered ?? '';
  return {
    ...toSummary(r),
    contentHtml: html,
    contentText: stripHtml(html),
    modified: normalizeDate(r.modified),
    author: r.author ?? 0,
  };
}

async function fetchJson(url) {
  const r = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-cache',
    headers: { Accept: 'application/json' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`uscreditcardguide: GET ${url} → HTTP ${r.status}`);
  return await r.json();
}

export default defineSkill({
  searchPosts: fn({
    summary: 'Search blog posts. Returns flat summaries. ★ primary entry.',
    input: z.object({
      query: z.string().describe('Search query; pass an empty string to list everything.'),
      perPage: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
      categoryId: z.number().int().positive().optional(),
    }),
    examples: [{ args: { query: 'amex platinum 175k', perPage: 5 } }],
    handler: async ({ query, perPage, page, categoryId }) => {
      const sp = new URLSearchParams({
        per_page: String(Math.min(100, Math.max(1, perPage ?? 10))),
        page: String(Math.max(1, page ?? 1)),
        _fields: SUMMARY_FIELDS,
      });
      if (query) sp.set('search', query);
      if (categoryId != null) sp.set('categories', String(categoryId));
      const arr = (await fetchJson(`/wp-json/wp/v2/posts?${sp.toString()}`)) ?? [];
      return Array.isArray(arr) ? arr.map(toSummary) : [];
    },
  }),

  getPost: fn({
    summary: 'Fetch a single post by id or slug.',
    input: z
      .object({
        id: z.number().int().positive().optional(),
        slug: z.string().optional(),
      })
      .refine((v) => v.id != null || !!v.slug, { message: 'pass id or slug' }),
    handler: async ({ id, slug }) => {
      if (id != null) {
        const sp = new URLSearchParams({ _fields: FULL_FIELDS });
        const r = await fetchJson(`/wp-json/wp/v2/posts/${id}?${sp}`);
        return r ? toFull(r) : null;
      }
      const sp = new URLSearchParams({ slug, _fields: FULL_FIELDS, per_page: '1' });
      const arr = (await fetchJson(`/wp-json/wp/v2/posts?${sp}`)) ?? [];
      return arr[0] ? toFull(arr[0]) : null;
    },
  }),

  summarizePost: fn({
    summary: 'Fetch a post by slug and return a tldr-style summary.',
    input: z.object({
      slug: z.string().min(1),
      maxChars: z.number().int().min(80).max(20000).optional(),
    }),
    handler: async ({ slug, maxChars }) => {
      const sp = new URLSearchParams({ slug, _fields: FULL_FIELDS, per_page: '1' });
      const arr = (await fetchJson(`/wp-json/wp/v2/posts?${sp}`)) ?? [];
      const post = arr[0] ? toFull(arr[0]) : null;
      if (!post) throw new Error(`summarizePost: no post with slug "${slug}"`);
      const max = Math.max(80, maxChars ?? 1200);
      const tldr =
        post.contentText.length > max
          ? `${post.contentText.slice(0, max - 1).trimEnd()}…`
          : post.contentText;
      return { title: post.title, date: post.date, tldr, link: post.link };
    },
  }),

  listCategories: fn({
    summary: 'List all post categories (up to 100).',
    input: z.object({}),
    handler: async () => {
      const sp = new URLSearchParams({ per_page: '100', _fields: 'id,name,slug,count' });
      const arr = (await fetchJson(`/wp-json/wp/v2/categories?${sp}`)) ?? [];
      return arr.map((c) => ({ id: c.id, name: stripHtml(c.name), slug: c.slug, count: c.count ?? 0 }));
    },
  }),
});
