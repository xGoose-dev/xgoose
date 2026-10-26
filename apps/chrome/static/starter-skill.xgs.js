// ==XGooseSkill==
// @name my-page-reader
// @namespace myPage
// @version 0.1.0
// @description Read the title and visible text on my website.
// @match https://example.com/*
// @primary readCurrent
// ==/XGooseSkill==
import {defineSkill, fn} from '@xgoose/skill';
import {z} from 'zod';
export default defineSkill({
  readCurrent: fn({
    summary: 'Read this page title and up to 8000 characters of visible text.',
    input: z.object({}),
    handler: () => ({title: document.title, text: document.body.innerText.slice(0, 8000)})
  })
});
