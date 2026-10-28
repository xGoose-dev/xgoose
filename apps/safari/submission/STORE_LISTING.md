# iOS 1.8 brand and listing refresh

Canonical fields are in `metadata-1.8.json`. The app remains xgoose; the promotional positioning is “Tampermonkey for AI”. iOS capabilities are limited to packaged skills, unlike desktop community-script installation. Release remains manual. No macOS binary is part of this submission.

## en-US

Subtitle: Website skills for your AI

Promotional text: Tampermonkey for AI. Give your assistant website skills in Safari. Read, research and follow sources with built-in tools and the AI you choose.

Think of xgoose as Tampermonkey for AI: website skills that help your assistant work with the sites you use. On iPhone and iPad, these skills come built into the Safari extension. Ask about a page, search supported websites, and follow links back to the original sources.

RESEARCH WHERE YOU BROWSE
Read an article, explore a forum, or ask a follow-up question without leaving the page. Website skills give xgoose tools for supported sites, including Hacker News, Reddit, V2EX, NGA, Weibo and Discourse forums. Available tools and results depend on the website, its permissions and your sign-in status. Check the sources before relying on an AI answer.

CHOOSE YOUR AI
Sign in by email to use xgoose Hosted AI with your account's available credit, or bring your own API key without creating an xgoose account. BYOK supports Gemini and OpenAI-compatible HTTPS services, including LiteLLM. Available Hosted models and trial credit follow the current account policy. Third-party providers may charge for their services.

KEEP THE CONVERSATION GOING
Stream answers, stop a response, add selected images, revisit local conversation history and export your chats. Long conversations manage their context automatically. Content already received is retained if a run is interrupted. Image support depends on the selected model.

SET UP IN THE APP
Choose your language, connect your AI and follow the Safari extension setup guide. The interface supports English, Chinese and Spanish. Grant access to one website or choose broader access in Safari, then open xgoose on the page you want help with. Setup can be paused and resumed.

CLEAR DATA CHOICES
API keys and account credentials are stored in the device-only iOS Keychain. BYOK sends content needed for your request to your chosen provider; BYOK conversations remain local and are not uploaded to xgoose. Hosted AI sends relevant messages and page content to xgoose and its AI providers. Hosted conversations are stored for 90 days, with credential redaction and audited access by authorized administrators. Optional usage analytics are off on a new installation. Account deletion is available in the app.

Built-in executable website skills ship with app updates. The iOS app does not install community scripts, edit scripts, run AI-generated JavaScript or download executable skill updates.

Requires iOS or iPadOS 18 or later and an AI connection. Enable xgoose in Settings > Apps > Safari > Extensions, then allow it on the website you want to use.

Open source: https://github.com/xGoose-dev/xgoose
Support: https://xgoose.org/support/
Privacy: https://api.xgoose.org/privacy/ios

### What’s New

• A new xgoose icon, aligned with our browser extensions and website, including dark and tinted appearances.
• Refreshed branding in the app.
• New English and Simplified Chinese App Store screenshots and descriptions for iPhone and iPad.

## zh-Hans

Subtitle: 给 AI 装上网站技能

Promotional text: AI 的 Tampermonkey。给 AI 装上网站技能，在 Safari 中读网页、做研究、追溯来源。iPhone 和 iPad 使用随 App 内置的技能，并支持你选择的 AI。

把 xgoose 想成 AI 的 Tampermonkey：给 AI 装上网站技能，让它更懂你正在使用的网站。在 iPhone 和 iPad 上，这些技能随 Safari 扩展内置。围绕当前网页提问，搜索支持的网站，再沿着原始链接核实来源。

在浏览的地方做研究
阅读文章、探索论坛、继续追问，无需离开当前页面。内置技能为支持的网站提供专门工具，包括 Hacker News、Reddit、V2EX、NGA、微博和 Discourse 论坛。可用工具和结果取决于网站、访问权限以及登录状态。AI 回答可能有误，请核实来源。

选择你自己的 AI
通过邮箱确认登录，使用 xgoose Hosted AI 和账户中的可用额度；也可以使用自己的 API Key，无需创建 xgoose 账户。BYOK 支持 Gemini 和 OpenAI 兼容的 HTTPS 服务，包括 LiteLLM。托管模型和试用额度以当前账户政策为准，第三方服务商可能单独收费。

让对话继续
查看流式回答、随时停止生成、附加选定图片、回顾本地聊天历史并导出对话。长对话会自动管理上下文；任务中断后，已经收到的内容仍会保留。图片能力取决于所选模型。

在 App 中完成设置
选择语言、连接 AI，再按指引启用 Safari 扩展。界面支持中文、英文和西班牙语。你可以仅授权一个网站，也可以在 Safari 中选择更广的访问范围，然后在需要帮助的页面打开 xgoose。首次设置支持暂停和继续。

清晰的数据使用说明
API Key 和账户凭据保存在本机 iOS 钥匙串中。使用自己的服务商时，请求所需内容会发送给该服务商；BYOK 对话保留在本地，不上传到 xgoose。使用托管 AI 时，相关消息和网页内容会发送给 xgoose 及其 AI 服务商。托管对话保存 90 天，上传前进行凭据脱敏，授权管理员的读取会留下审计记录。新安装默认关闭可选使用统计，App 内提供账户删除入口。

可执行的网站技能随 App 更新内置。iOS 版本不安装社区脚本、不编辑脚本、不运行 AI 生成的 JavaScript，也不下载可执行技能更新。

需要 iOS 或 iPadOS 18 及以上版本，并连接 AI 服务。请在“设置 > App > Safari > 扩展”中启用 xgoose，再授权你想使用的网站。

开源项目：https://github.com/xGoose-dev/xgoose
使用帮助：https://xgoose.org/support/
隐私政策：https://api.xgoose.org/privacy/ios

### What’s New

• 更新 xgoose 图标，与官网和其他浏览器扩展统一，支持深色与着色外观。
• 更新 App 内的品牌图标与主题色。
• 为 iPhone 和 iPad 提供全新的中文、英文 App Store 展示图和介绍。

## Artwork and provenance

The original master is `branding/icon.svg`, shared with Chrome, Edge and Firefox. Run `node apps/safari/scripts/render-brand.mjs` to regenerate the native default, dark and tinted icons.

`artwork-1.8/manifest.json` lists 22 localized editorial screenshots and SHA-256 checksums: four iPhone screenshots at both 1320 × 2868 and 1206 × 2622, and three iPad screenshots at 2752 × 2064 per language. Run `node apps/safari/scripts/render-store-artwork.mjs` to regenerate from `raw/`. Preview contact sheets are excluded from uploads.

Home, skills and provider screenshots were captured on fresh iOS 26.5 simulators running the 1.8 app, in English and Simplified Chinese. The research images retain the real Safari research captures previously prepared for the public app, showing the unchanged chat interface. These are real UI captures with editorial framing, not fabricated product screens. No customer account, private conversation or credential appears in the assets.

The same iOS app/extension IDs, App Group and Keychain sharing are retained. Use the existing manual profiles for unsigned archive → `scripts/sign-ios-archive.py` → signed export. Check both shared entitlements in the exported IPA before uploading. Review credentials stay solely in App Store Connect Notes and are not part of this repository or artwork.
