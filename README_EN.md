<p align="center">
  <img src="desktop/src/renderer/public/brand/logo-mark-256.png" width="96" alt="Oh My Token">
</p>

<h1 align="center">Oh My Token</h1>

<p align="center">
  See where your AI tokens go — across agents, models, sessions, and projects.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://ohmytoken.net">Download for Windows / macOS</a> ·
  <a href="#supported-agents">Supported agents</a> ·
  <a href="#product-preview">Product preview</a>
</p>

Oh My Token is a desktop app for understanding usage across multiple AI agents. It reads local usage records from [multiple supported agents](#supported-agents) and brings tokens, reference API costs, sessions, and projects into one workspace. Check provider quotas and account balances while you work, then turn your usage into a visual recap to share. Discover also includes Cyber Eggs activity calendars, plan and API price comparison, AI insights, and agent downloads.

## Product preview

Usage, amounts, quotas, prices, and activity entries use demo data. The AI insights screenshots show online content loaded in the installed production app. Click an animation to open its full-resolution still image.

[![Usage analytics by model, agent, and project](docs/screenshots/readme/analytics-en.gif)](docs/screenshots/readme/analytics-en.png)

### See usage and reference costs together

Compare tokens and estimated API costs over a date range. Explore trends by agent, model, or project to see where usage is concentrated. Cost estimates are reference figures, not provider invoices or subscription deductions.

[![Usage overview with date filters, token totals, cost estimates, and model trends](docs/screenshots/readme/overview-en.gif)](docs/screenshots/readme/overview-en.png)

### Follow usage into sessions and projects

Search and filter sessions, expand sub-sessions, and inspect model calls and token details. The project workspace groups usage by its recorded directory. Organize projects and favorite sessions or projects you want to follow.

[![Session workspace with a session list, filters, and usage details](docs/screenshots/readme/sessions-en.gif)](docs/screenshots/readme/sessions-en.png)

<details>
<summary>View the project workspace</summary>

![Project list and selected project usage details](docs/screenshots/readme/projects-en.png)

</details>

### Check quotas and balances

Discover supported provider connections on your computer and check remaining quotas, account balances, and reset times together. Existing DeepSeek Harness sign-ins and DeepSeek API keys are supported, with balances shown by currency.

[![Updated quota view with quota windows, reset times, and DeepSeek balances](docs/screenshots/readme/quota-en.gif)](docs/screenshots/readme/quota-en.png)

Quota fields depend on the provider, account authorization, and connection. Support for scanning an agent's local usage does not imply support for querying its provider quota.

### Keep usage within reach

The desktop floating window has Token and Quota tabs. Collapse it for a quick summary or expand it for trends, followed sessions, and quota windows. Keep it on top, reorder sessions and followed accounts, and switch the expanded Quota view between bars and orbs.

|                                                                                                                  Token                                                                                                                  |                                                                                                                          Quota                                                                                                                           |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| **Expanded**<br><a href="docs/screenshots/readme/floating-token-expanded-en.png"><img src="docs/screenshots/readme/floating-token-expanded-en.png" width="420" alt="Expanded Token window with usage trends and followed sessions"></a> |         **Expanded**<br><a href="docs/screenshots/readme/floating-quota-expanded-en.png"><img src="docs/screenshots/readme/floating-quota-expanded-en.png" width="420" alt="Expanded Quota window with followed accounts and quota windows"></a>         |
|        **Collapsed**<br><a href="docs/screenshots/readme/floating-token-collapsed-en.png"><img src="docs/screenshots/readme/floating-token-collapsed-en.png" width="420" alt="Collapsed Token window with a usage summary"></a>         | **Collapsed**<br><a href="docs/screenshots/readme/floating-quota-collapsed-en.png"><img src="docs/screenshots/readme/floating-quota-collapsed-en.png" width="420" alt="Collapsed Quota window with balances, remaining allowances, and reset times"></a> |

### Create a usage recap to share

Turn local usage into animated rankings, trends, and changing shares, or a still summary card. Export GIF, WebP, MP4, PNG, or JPG. These are visual summaries built from time-based usage totals.

[![Usage recap editor with animated rankings, a timeline, and export settings](docs/screenshots/readme/replay-en.gif)](docs/screenshots/readme/replay-en.png)

### Discover insights and tools

Discover brings together Cyber Eggs, plan and API price comparison, AI insights, and agent downloads. These features require an internet connection.

#### Cyber Eggs

Browse provider updates on quota resets, reset cards, limited-time free offers, and token grants. Filter recent activities by provider on the home page, then open a provider's monthly calendar to inspect dates, details, and available source links. Switch display time zones as needed. Dates and eligibility follow the provider's official information and account terms.

![Cyber Eggs home with provider entries, a recent activity feed, and provider filters](docs/screenshots/readme/cyber-eggs-home-en.png)

<details>
<summary>View the provider activity calendar</summary>

![GPT activity calendar with monthly browsing, daily activity markers, and time zone switching](docs/screenshots/readme/cyber-eggs-calendar-en.png)

</details>

#### Plan and API price comparison

Compare plans by billing period and check model API prices to find options that fit your workload.

![Provider plan comparison with billing-period filters](docs/screenshots/readme/plans-en.png)

#### AI insights

Browse articles about models, tools, and practical workflows by category, then open an article to read more.

![AI insights with category filters, featured articles, and reading links](docs/screenshots/readme/insights-en.png)

#### Agent downloads

Filter agents by platform and tool type, then explore their overviews, installation guides, and official links.

![Agent downloads with featured tools, platform filters, and an agent catalog](docs/screenshots/readme/agents-en.png)

## Supported agents

A selection of supported agents is shown below. Support continues to grow.

[![DeepSeek Harness, Codex, MiniMax Code, OpenCode, Z Code, WorkBuddy, KimiWork, Kimi Code, Antigravity, Qwen Code, OpenClaw, Grok, Hermes, and Claude Code](docs/screenshots/readme/supported-agents.gif)](docs/screenshots/readme/supported-agents.png)

Available details depend on what each agent records locally. Token breakdowns and generation metrics vary by source; some sources provide estimated generation rates.

Antigravity desktop support reads the local session database for usage, sessions, projects, native time to first token, and model generation rates. Provider quotas are queried from Google's cloud over HTTPS, using Windows Credential Manager or the macOS login keychain; Antigravity does not need to remain open. Quota windows reflect what the account actually exposes, and missing values are not shown as zero or full allowances.

## Get started

1. Download the app from the [Oh My Token website](https://ohmytoken.net). Builds target Windows x64 and macOS on Intel or Apple Silicon.
2. Install and open the app, then start a scan to read usage records from supported agents on your computer.
3. Explore the overview, sessions, projects, and analytics. If you have already signed in to or configured a supported provider in an agent, open Quota and refresh to check its allowances.
4. Open the floating window for a quick view while you work, or create a recap in Generation history.

The interface supports Simplified Chinese and English, light and dark appearances, multiple color palettes, window materials, and reduced motion.

## Local data and online features

Usage statistics are processed on your computer, and local scanning works without the cloud being online. Your model requests do not pass through Oh My Token.

Sign-in, discovery content, updates, and provider quota queries use the network. The client sends necessary device and version information; runtime errors may send minimal, sanitized diagnostic events. Uploading detailed diagnostic logs requires your confirmation.

The app also offers network checks and process traffic monitoring to help inspect connectivity and sent and received traffic, subject to platform support and system permissions.

## License and commercial authorization

This version uses the [Oh My Token Source-Available License 1.0](LICENSE).
Personal and internal business use, modification, and free redistribution are permitted without software license fees, subject to its terms.
**Selling the software or derivative versions, making access to the software conditional on purchasing a paid product or service, or charging third parties for hosted access to all or substantially all of its functionality, requires the licensor's prior written authorization.**
**Modified versions distributed outside the organization or offered as online services to third parties must have their complete corresponding source made publicly available at no charge, with covered derivative modifications under the same license. Internal-only modifications need not be published.**
Sales or hosting authorization does not waive those source obligations. Section 4 describes permitted genuine technical services.

This is not MIT or an OSI-approved open-source license. Previously granted MIT rights and the independent licenses of third-party components remain effective; see [licensing scope](LICENSE_SCOPE.md) and the [historical MIT notice](LICENSE-MIT-LEGACY).
See the [commercial authorization guide](COMMERCIAL_LICENSE.md) for examples and authorization details. Commercial authorization must be confirmed separately in writing by the licensor; payment or donation alone is not authorization. The official project website is [ohmytoken.net](https://ohmytoken.net).

Third-party versions, sources, and original licenses are listed in [third-party software notices](desktop/third-party-licenses/THIRD_PARTY_NOTICES.md), also available offline in Settings → About and updates → Open-source software notices.
