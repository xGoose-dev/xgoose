// ==XGooseSkill==
// @name page-headings
// @namespace pageHeadings
// @version 1.0.0
// @description Read the current page title and headings without changing the page.
// @match https://example.com/*
// ==/XGooseSkill==
import { defineSkill, fn } from '@xgoose/skill';
import { z } from 'zod';
export default defineSkill({
  read: fn({
    summary: 'Read the current page title and heading outline',
    input: z.object({}),
    handler: async () => ({
      title: document.title,
      url: location.href,
      headings: [...document.querySelectorAll('h1, h2, h3')].slice(0, 100)
        .map(el => ({ level: el.tagName, text: el.textContent?.trim() ?? '' })),
    }),
  }),
});
