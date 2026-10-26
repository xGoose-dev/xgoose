// ==XGooseSkill==
// @name         xgoose-guide
// @namespace    xgooseGuide
// @version      0.1.3
// @description  xgoose setup and help: choose the right website, enable website skills, install or write a skill, and understand incomplete reads or failed searches. Only active on xgoose.org.
// @match        https://xgoose.org/*
// @match        https://www.xgoose.org/*
// @primary      getStarted
// @keyword      xgoose
// @keyword      setup
// @keyword      help
// @keyword      skills
// ==/XGooseSkill==
import {defineSkill,fn} from '@xgoose/skill';
import {z} from 'zod';
const links={forum:'https://www.uscardforum.com/',hackerNews:'https://news.ycombinator.com/',catalog:'https://xgoose.org/skills/',authoring:'https://xgoose.org/docs/skills/',support:'https://xgoose.org/support/'};
const installSteps=[
 'Built-in skills are included, enabled and usable without Allow User Scripts. Open their matching website; use skill_call to invoke them. Enable Allow User Scripts for community skills, local edits, online-updated scripts and custom JavaScript.',
 'For community skills, browse xgoose.org/skills, review the source and matching websites, then choose Install.',
 'For a local file, URL or pasted code, open extension Settings → Skills → Install from file or URL. Load the .xgs.js file or paste its source, review the preview, then click Install.',
 'After installing, return to a matching website. A skill installed for a forum does not run in Gmail or on the xgoose login page.',
 'In Settings → Skills, expand Manage installed skills to enable, disable or edit source. Use Check for updates and review replacements; local edits are flagged.'
];
const fixes={
 wrong_site:{problem:'A forum question was asked on an email or xgoose login page.',steps:['Open the website you want to search or read. For US Card Forum questions, open https://www.uscardforum.com/.','Open xgoose in that website tab and ask again. Sign in to the website itself if the content requires membership.','The current tab determines active website skills. Signing in to xgoose does not automatically search every installed website.'],links},
 user_scripts:{problem:'Built-in skills work immediately. Community skills, local edits, online-updated scripts and custom JavaScript require Allow User Scripts.',steps:['In extension Settings, click Enable Allow User Scripts to open this extension’s Chrome details page.','Below Site access, turn on Allow User Scripts. Use Getting started for the highlighted Chrome screenshot.','Return to xgoose; the permission reminder rechecks and hides when enabled. Retry the original request.']},
 incomplete_thread:{problem:'A preview or selected summary is being mistaken for the whole thread.',steps:['Ask xgoose to read the remaining replies in batches.','The forum reader has a five-post preview and a separate range reader. For replies or full-thread research, use discourse.readTopicPosts and follow next_cursor sequentially.','Use a targeted range or the next cursor to continue through replies.','Search offer discussions and read relevant recent replies.']},
 search_failed:{problem:'A script completed, but its internal searches returned no evidence.',steps:['Check the actual results. Failed to fetch, a rejected Promise.allSettled item, or HTTP 429/403/401 is not a successful source read.','Open the intended website and use its active skill. Do not repeatedly fetch Google or Bing from an unrelated email or login page.','Respect the site’s retry time for 429, sign in to that site if necessary, and say when no results were retrieved. Website not recorded in an older transcript does not mean the forum is unindexed.']},
 hosted_or_byok:{problem:'xgoose sign-in, website sign-in and an AI provider key are being confused.',steps:['Use free Hosted AI by signing in to xgoose with email and checking available trial credit. No key needs to be copied.','Choose BYOK only when you want your own AI provider, endpoint and key.','Your forum or other website login is separate. Its session controls which content its skill can access.']}
};
const starter=`// ==XGooseSkill==
// @name my-page-reader
// @namespace myPage
// @version 0.1.1
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
});`;
export default defineSkill({
 getStarted:fn({summary:'Explain which website tab to use after sign-in, and how to open the assistant there.',input:z.object({}),handler:()=>({context:'This is the xgoose product or account website. It is not the forum or another source website.',steps:['Complete setup and email confirmation here.','Open the website you want help with, such as US Card Forum or Hacker News.','Open xgoose from the floating button or Chrome toolbar in that website tab, then ask your question.','Only matching website skills are active. Use your own website login for restricted content.'],links})}),
 troubleshoot:fn({summary:'Resolve common setup and evidence mistakes with concrete steps. Does not inspect emails, cookies or account data.',input:z.object({issue:z.enum(['wrong_site','user_scripts','incomplete_thread','search_failed','hosted_or_byok'])}),handler:({issue})=>fixes[issue]}),
 installSkills:fn({summary:'Explain catalog, local-file, URL and pasted-source installation, source review and updates.',input:z.object({}),handler:()=>({steps:installSteps,links})}),
 writeSkill:fn({summary:'Provide a valid minimal .xgs.js starter and the authoring and test workflow.',input:z.object({}),handler:()=>({steps:['Open the authoring guide or use Create from starter in extension Getting started.','Choose a unique @name and @namespace, set @version, and narrow @match to the intended website.','Describe each function and its input schema. Prefer a read-only first function and bounded results.','Load the .xgs.js in the installer, review it and click Install. Open the matching website to test.','Use Settings → Skills → Manage installed skills → Edit to revise source. Increment the skill version when sharing updates. Local use does not require publishing or an xgoose account.'],starter,links})})
},{instructions:"Help the user start on the intended website, install or author skills, and fix setup issues. For another website, provide its link and explain how to open xgoose in that tab. Use list_skills to find installed skills. Explain xgoose sign-in and website sign-in separately. For authoring, provide a minimal source example and the authoring guide. Reply in the user's language.",actions:[{label:'Start on the right website',prompt:'Explain how to use xgoose on the website I actually want to search. Give a clickable website link and short steps in my language.',js:'return await xgoose.skills.xgooseGuide.getStarted({});'},{label:'Install a skill',prompt:'Explain how I can install a website skill from the catalog, file, URL or pasted code. Give the Settings path and documentation links.',js:'return await xgoose.skills.xgooseGuide.installSkills({});'},{label:'Write a skill',prompt:'Help me write and test a minimal website skill. Explain @match, use a read-only starter, and provide the authoring guide.',js:'return await xgoose.skills.xgooseGuide.writeSkill({});'}]});
