# iOS 1.6 replacement listing

## Description (en-US)

Your AI, on the page. xgoose brings a floating AI assistant to Safari on iPhone and iPad. Read a page, research supported websites with built-in skills, and follow the original sources without leaving your tab.

GET STARTED IN THE APP
Choose your language, connect an AI provider, review your model and data use, then enable the Safari extension. Setup can be paused and resumed. Grant access to one website or choose broader access in Safari.

YOUR CHOICE OF AI
Use xgoose Hosted with email confirmation sign-in and your account's available credit, or bring your own API key without an xgoose account. Supported BYOK connections include Google Gemini, Gemini through LiteLLM, and OpenAI-compatible HTTPS services. Hosted availability and models follow the current account policy. Third-party providers may charge for their services.

RESEARCH WITH WEBSITE SKILLS
Built-in tools adapt to supported websites including Discourse forums, US Card Forum, Hacker News, Reddit, Weibo and NGA. Search and read the site's available information, summarize discussions, and keep original links. Website login and access restrictions still apply. On ordinary pages, ask questions about the content you are viewing.

KEEP YOUR WORK
Stream answers, stop a response, attach selected images, revisit local history, and export conversations. Long conversations use the shared xgoose context management. Received content is retained when a run is interrupted.

CLEAR DATA CHOICES
API keys and account credentials are stored in the shared iOS Keychain. BYOK sends selected content to your chosen provider; BYOK conversations are not uploaded to xgoose. Hosted sends relevant messages, page content and images to xgoose and its AI providers; Hosted conversations are stored in the cloud and may be accessed by authorized administrators. Optional usage analytics are off on a new installation. Account deletion is available in the app.

Built-in executable skills ship with app updates. This iOS release does not install community scripts, edit scripts, run AI-generated JavaScript, or download executable skill updates.

Requires iOS or iPadOS 18 or later. Enable xgoose in Settings > Apps > Safari > Extensions. On a website, open Safari's page menu, allow xgoose for that website, and open its chat. An AI connection is required for answers.

## What's New (en-US)

• Rebuilt for iPhone and iPad using the current xgoose agent and chat experience.
• Native setup with resumable email sign-in, BYOK connections, model and data-use confirmation, and Safari permission guidance.
• Built-in website skills, image input, streaming, conversation history and export.
• Shared Keychain credential storage, upgrade migration, optional analytics off by default, and in-app account deletion.
• Improved Safari keyboard, page zoom and interrupted-session handling.

## Keywords

AI,chat,assistant,Safari,extension,Gemini,OpenAI,skills,research,forum,summary,web,agent

## Public URLs

Privacy: https://api.xgoose.org/privacy/ios
Support: https://xgoose.org/support/

## Review notes template (credential is inserted only into ASC)

This is a replacement iOS 1.6 build under the existing app identity. Release remains manual.

Fast review path without an xgoose account:
1. Open xgoose and choose English. Select Connect AI > Provider > Gemini.
2. Paste the dedicated review API key from these ASC notes. Keep Base URL empty, use model gemini-2.5-flash, tap Agree & save connection, then Test connection.
3. Enable xgoose in Settings > Apps > Safari > Extensions. On iOS 26.2 or later the app also provides Open extension settings.
4. Open https://news.ycombinator.com/ in Safari. In the page menu, choose xgoose and allow this website. Authorization for all websites is optional. Reload if the page was open before activation.
5. Open xgoose chat from Safari's menu or the floating launcher. Ask: "Show three top Hacker News stories with original article and discussion links." The packaged skill returns public site data. You can also ask about a normal page and attach an image.
6. History, Stop and Export are available in the Safari chat.

Optional Hosted path: native Account > enter an email you control > confirm the sign-in email > return to xgoose > review available models, credit and cloud storage disclosure > Agree & use Hosted > Test connection. An email-confirmed account can be deleted in native Account > Delete account & cloud data.

Keys and account credentials are in shared device-only Keychain storage. Ordinary settings use the existing App Group. Website scripts cannot access credentials. Hosted conversations are stored on xgoose services with the disclosed policy; BYOK conversations are local to the extension and are not uploaded to xgoose. Third-party model providers receive the content used for the requested answer.

All executable website skills are packaged in this binary. Dynamic JavaScript, community installation, script editing and remote executable updates are unavailable in this release. Website permissions, website sign-in, and xgoose AI sign-in are separate.

The dedicated review key is provided solely in ASC Notes and is not in the source or app bundle.
