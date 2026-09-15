# Lotus 聊天界面 GitHub 调研

调研日期：2026-09-13。目标是莲花 Lotus 的单一聊天 Agent 界面：温和陪伴、净土伴修，以及通过对话完成个人记录。以下项目用于交互与视觉参考，本次没有复制项目代码或安装依赖。

## 建议采用的方向

以 **Zola 的聊天布局 + prompt-kit 的视觉细节**为主要参考，保留 Lotus 已接入的 **assistant-ui、Cloudflare Agent 和现有写入确认逻辑**；从 **Haven** 借鉴轻量的陪伴提示。从 AIRI、Amica、SillyTavern 中选择具体交互细节，避免为了视觉改造引入整套新后端或角色渲染系统。

莲花保持净土伴修 Agent 的身份。这里借鉴的是亲切、稳定、易于持续交谈的体验，**不把恋爱人设、排他关系或角色扮演设定套给莲花**。

以下改造成本为针对当前 Lotus 的工程判断，不代表上游项目质量评级，也不是工期承诺。

| 项目 | 主要用途 | Lotus 建议 | 改造成本判断 | 许可证原文件 |
| --- | --- | --- | --- | --- |
| [Zola](https://github.com/ibelick/zola) | 完整的多模型聊天应用 | 首选布局参考 | 参考布局低；整套迁移高，涉及 Next.js、Supabase 认证与存储 | [Apache-2.0 · LICENSE](https://github.com/ibelick/zola/blob/main/LICENSE) |
| [prompt-kit](https://github.com/ibelick/prompt-kit) | 可定制 AI 界面组件 | 首选视觉与组件细节参考 | 视觉调整低；实际引入组件中，需要协调 shadcn/ui、样式与已有聊天状态 | [MIT · LICENCE.md](https://github.com/ibelick/prompt-kit/blob/main/LICENCE.md) |
| [Haven](https://github.com/amarisaster/Haven) | 自托管 AI 陪伴聊天 | 借鉴身份提示、聊天连续感和个人化细节 | 参考细节低；整套整合中高，仍需重接 Lotus 账号、数据隔离和工具确认 | [Apache-2.0 · LICENSE](https://github.com/amarisaster/Haven/blob/main/LICENSE) |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | React 聊天基础组件与运行时适配 | 继续使用，定制呈现 | 已在 Lotus；基于现有组件改造较低 | [MIT · LICENSE](https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE) |
| [AIRI](https://github.com/moeru-ai/airi) | 带虚拟形象和语音的陪伴系统 | 借鉴微动效和流式文字体验 | 参考细节低；整套复用高，涉及 Vue 多包架构、Live2D、VRM、音频等 | [MIT · LICENSE](https://github.com/moeru-ai/airi/blob/main/LICENSE) |
| [Amica](https://github.com/semperai/amica) | 3D 虚拟形象陪伴聊天 | 借鉴完整聊天与迷你形象的组合 | 参考布局低；整套复用高，涉及 Three.js、VRM、语音与视觉 | [MIT · LICENSE](https://github.com/semperai/amica/blob/master/LICENSE)，模型和图片另行授权 |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | 高度可配置的角色聊天界面 | 借鉴文本阅读与移动端输入细节 | 参考细节低；整套复用高，配置复杂且需处理 AGPL 适用要求 | [AGPL-3.0 · LICENSE](https://github.com/SillyTavern/SillyTavern/blob/release/LICENSE) |

## 主要参考与依据

### Zola：让聊天成为页面中心

主线程实际打开了 [Zola 官网](https://zola.chat)，并保存了 1280 × 720 的首页截图。该状态展示了轻量顶栏、居中问候、宽输入框和输入框下的建议入口，视觉焦点很明确。这支持将 Lotus 的首屏重点放在“开始说一句话”，让其他功能退到对话或抽屉中。

[查看本次 Zola 首页截图](/Users/bincai/Downloads/foyue/Lotus/output/playwright/reference-zola.png)

Zola 官方 README 列出响应式明暗主题、prompt-kit、shadcn/ui，并说明认证和存储使用 Supabase；仓库采用 Next.js。建议复用其空间关系与轻量操作层级，由 Lotus 自己实现。无需把 Zola 的多模型选择和完整应用架构带入莲花。[官方仓库与 README](https://github.com/ibelick/zola)

### prompt-kit：设计工程师的聊天组件参考

作者 [Julien Thibeaut 的个人网站](https://ibelick.com/)明确介绍其身份为 Design Engineer，并列出 prompt-kit。它是可单独选取和定制的 AI 界面组件集合，README 的安装方式基于 shadcn/ui。[官方仓库](https://github.com/ibelick/prompt-kit)、[组件官网](https://www.prompt-kit.com/)

建议参考输入区域的边界、内边距、操作按钮密度，以及消息和等待状态的视觉层次。Lotus 已有聊天运行时，视觉改造应继续由现有状态驱动；若后续选择引入某个组件，再单独核对其依赖与交互，而不是并存两套消息状态管理。

### Haven：温和陪伴的细节

Haven 是自托管的陪伴聊天应用，使用 React 19 前端和 Cloudflare Workers。README 描述了持续加载的角色身份、历史对话、聊天反应、背景和状态提示，也明确说明它目前是具有身份持久化的聊天界面，**不是完整记忆系统**，不能由此推断它已实现自动上下文召回或复杂记忆引擎。[官方仓库与 README](https://github.com/amarisaster/Haven)

Lotus 可参考简短身份提示、可继续的历史聊天和克制的个性化。多角色家庭、角色网格及大量模型配置不适合当前单一莲花界面。技术栈接近只能减少部分界面适配成本，不能替代 Lotus 的账号、存储和审批设计。

### assistant-ui：保留现有聊天基础

assistant-ui 提供可组合的 React 聊天组件、可定制样式、运行时适配，以及工具结果和内联人工确认的呈现能力。[官方 README](https://github.com/assistant-ui/assistant-ui)

本地 `package.json` 和 `src/components/chat/Chat.tsx` 已确认 Lotus 使用 `@assistant-ui/react`，并连接 `agents/react` 与 `@cloudflare/ai-chat/react`。因此，优先在现有消息与输入组件上调整视觉。写入确认仍须使用 Lotus 自己的服务端约束，组件库的确认界面不能单独承担授权。

## 陪伴类项目的补充参考

### AIRI

AIRI 面向带形象和语音的 AI 陪伴体验。官方材料展示了 Live2D、VRM 与音频链路；记忆相关部分仍有 WIP 标记，不应视为已完成的通用记忆方案。[官方 README](https://github.com/moeru-ai/airi)

最值得借鉴的是文字出现时的细腻反馈。官方开发日志讨论了聊天气泡动画，以及流式文本中 Unicode 完整字符的处理，还提供减少动画选项。Lotus 可以采用轻微淡入和清晰的等待状态，保持文字立即可读。[官方开发日志](https://airi.moeru.ai/docs/en/blog/DevLog-2025.08.01/)

### Amica

Amica 的官方 Quickstart 说明，Chat Toggle 会显示整个对话，并把虚拟形象缩成迷你模式；这比让形象占据主画面更贴近 Lotus 的聊天优先需求。历史记录、静音和设置也有独立入口。[官方交互说明](https://docs.heyamica.com/getting-started/quickstart)

建议把这一原则化为小型莲花标识与完整消息流，不必引入 3D 角色。其代码主要使用 MIT，但 README 明确注明 3D 模型和图片由各自作者另行授权，不能把代码许可证当成素材许可证。[官方仓库](https://github.com/semperai/amica)

### SillyTavern

SillyTavern 官方 UI 文档提供连续聊天、气泡和文档式阅读，另有文字大小、聊天宽度、减少动画、移动端紧凑输入框等设置。Lotus 可参考舒适行宽、长文阅读和移动端输入；第一版不必向用户暴露所有外观参数。[官方 UI 文档](https://docs.sillytavern.app/usage/core-concepts/uicustomization/)

其 README 面向喜欢深度配置的用户，并明确不提供官方托管服务。整套角色、提示词和扩展配置会增加 Lotus 的交互复杂度，Node 服务也不能直接替换当前 Worker。建议限于设计参考；若实际复用代码，应按 AGPL-3.0 原文核对适用范围和相应义务。[官方仓库](https://github.com/SillyTavern/SillyTavern)、[许可证](https://github.com/SillyTavern/SillyTavern/blob/release/LICENSE)

## 对 Lotus 的具体建议

1. **首屏只有一个明显行动**：一句温和开场和一个输入框。少量建议用于开始聊天，不把功课、日记、账目和日程铺成首页功能面板。
2. **聊天过程中保持固定输入位置**：消息是主要内容，历史、账号和设置进入抽屉；辅助记录从对话中的卡片或用户明确打开的入口进入。
3. **让动作自然出现在对话里**：记录提案显示可读内容与确认按钮，成功后再显示保存结果；错误、取消和待确认都保留清晰区别。
4. **用小细节表达陪伴**：莲花标识、亲切文案、简短等待反馈即可。动效支持减少动画，不妨碍阅读，也不把等待表现成虚构的情绪。
5. **分开实现与参考**：Zola 负责启发布局，prompt-kit 启发视觉，Haven 启发陪伴细节；Lotus 的消息运行时、账号隔离、工具审批与持久化继续由现有实现负责。

## 验证范围与许可证说明

- Zola：已实际打开官网首页并留存上述截图；本次截图仅证明该首页状态，没有证明发送、登录、历史恢复或移动端交互已通过验收。
- 其余参考项目：已核对官方 README、官方文档或许可证；本次没有安装或逐项运行交互。AIRI 演示抓取仅得到需要 JavaScript 的页面；Amica 官方文档链接的演示抓取返回 402，因此未声称其当前演示可用。
- 官方体验入口：[Zola](https://zola.chat)、[prompt-kit](https://www.prompt-kit.com/)、[AIRI](https://airi.moeru.ai)、[Amica](https://amica.arbius.ai)、[assistant-ui 示例](https://www.assistant-ui.com/examples)。Haven 以官方仓库的截图和说明为依据。
- 许可证名称对应本次查阅的仓库原文件。MIT 与 Apache-2.0 的代码复用也需要保留适用声明；Apache-2.0 还涉及修改声明及适用的 NOTICE。SillyTavern 的 AGPL-3.0 应按实际复用与提供服务的方式核对。项目名称、商标、模型、图片等不能仅凭代码许可证推定可复用。
- 本文没有复制上游代码或素材，没有改变 Lotus 的依赖、认证、模型配置或应用行为。
