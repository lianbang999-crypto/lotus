# Lotus 法义检索接入

当前已完成可审查的本地集成、补丁生成器和大安法师资料适配器；没有修改原有 `wenchao` 项目，也没有部署或向远程知识库写入。Lotus 服务端使用 `WENCHAO_API_URL` 与 `WENCHAO_API_KEY` 调用检索，浏览器不持有文钞密钥。

## 已核验的现有实现

直接读取的源文件是 `/Users/bincai/Downloads/foyue/wenchao/workers/ai-proxy/worker.js` 和同目录 `wrangler.toml`。Worker 当前存在 `embed`、`buildRetrieval`、`queryKnowledgeBase`、`lexicalSearch`、`fuseRRF`、`dedupeMatches`、`rerankMatches`、`chunksOf`、`ensureFts`、`writeD1`。嵌入与重排实际走 SiliconFlow；旧 README 中的 Workers AI 说明已与代码不同。

| 现有资源 | 实际契约 | Lotus 使用方式 |
| --- | --- | --- |
| `VEC` | Vectorize `wenchao-kb`，现用 namespace `v2` | 印光资料保持 `v2`；大安资料使用 `daan-v1`，复用同一绑定和检索流程 |
| `DB` | D1 `wenchao-kb-fts`，FTS5 `chunks_fts` | 大安另用 `daan_chunks_fts`，另存 `lotus_daan_documents` 完成状态 |
| `RL` | 每 key 配额与原问答缓存 | 复用 key 配额；纯检索不使用答案缓存 |
| `API_KEYS` | Worker Secret JSON，`Authorization: Bearer` 或 `X-Api-Key` | 纯检索必须有有效服务端 key，不能仅凭 Origin/Referer 放行 |
| `INDEX_SECRET` | `X-Index-Secret` 保护建库 | 新增大安建库端点保持此鉴权 |
| `SILICONFLOW_API_KEY` | 嵌入、重排和原问答使用的 Secret | 复用嵌入、重排；不调用回答生成 |

原 `sourceType` 的 `primary/jiayan/selected` 表示文钞内部来源类别，不表示作者。Lotus 增加独立 `corpus` 和 `role`：`yinguang → basis`，`daan → guide`。大安讲记不冒充印光原文；经典、仪轨和印祖序跋不归入大安语料。

## 端点契约

目标端点：`POST https://wenchao.foyue.org/api/retrieve`。现有 `/api/ai*` 路由不会覆盖它，因此补丁同时增加 Wrangler route。Worker 直连和现有路径前缀还支持 `/retrieve`、`/api/ai/retrieve`。

```json
{
  "query": "念佛时心散乱，应该怎样摄心？",
  "corpora": ["yinguang", "daan"],
  "topK": 5,
  "rewrite": false
}
```

`query` 必须是 1–2000 字符；`corpora` 默认两库且不可重复；`topK` 是 1–8 的整数；`rewrite` 默认 `false`。设为 `true` 时只复用现有查询改写，不生成回答。Lotus 的 `searchDharma` 当前明确发送 `rewrite:false`。

成功返回 `{ok:true,query,passages,sources,retrieval}`：

| 字段 | 类型与含义 |
| --- | --- |
| `passages[].n` | 从 1 开始的整数引用号 |
| `id / aid` | 切块 id / 篇目 id，字符串 |
| `title / text / context` | 标题、准确命中片段、父段落，字符串 |
| `url` | 作者对应站点的 HTTPS 来源地址；上游地址不安全时为空字符串 |
| `pIndex / paraIndex / seg / part` | 可选非负整数，不是独立的页码承诺 |
| `vol / volName / sourceType` | 原有分册和类别信息，字符串 |
| `corpus / role` | `yinguang/basis` 或 `daan/guide`，对应关系固定 |
| `score / rerankScore` | 排序分数：前者为数字或 null，后者可选数字；不是教理正确率 |
| `sources[]` | `{id,title,url,corpus,role}`，按篇目去重 |
| `retrieval` | `{version:"lotus-r1",mode,corpora,warnings,unavailableCorpora,rewritten}` |

`mode` 是 `hybrid/vector/lexical`。`warnings` 和 `unavailableCorpora` 明确表示降级；大安尚未完成入库时返回 `daan:not_indexed`。部分库正常时可返回其真实证据，不能把另一库故障写成“原文无此开示”。所有请求库均不可用时返回 HTTP 503。正常零命中返回空 `passages`，不生成替代引文。

失败返回 `{ok:false,error:{code,message}}`，使用 400、401、413、429 或 503。建库另有 403、409。客户端必须验证整体响应、作者角色和来源地址，不得把未通过校验的来源展示为已核验引文。

现有 `ctx` 在建库时最多保留段首 1100 字。若命中的是长段后半截而不在 `ctx` 中，纯检索返回命中块本身作为 `context`，避免误把无关段首标为该命中的完整父段。这是现有索引的范围限制；完整长段恢复仍需源文回取或重新建库。

## 文件与本地准备

- `integrations/wenchao/lotus-retrieval.fragment.js`：新增处理器，以受控 namespace/table 包装现有绑定，复用原检索和建库函数。原 `/api/ai` 问答不改。
- `integrations/wenchao/prepare.mjs`：核对现有函数和路由插入点，输出完整 Worker、Wrangler 配置、统一补丁和源文件 SHA-256；拒绝原地覆盖。
- `integrations/wenchao/prepare-daan.mjs`：只读现有文库，验证来源路径、作者范围、正文、内容哈希，默认只打印报告；传 `--out` 才写本地请求批次。
- `integrations/wenchao/submit-daan.mjs`：操作员显式选择 `--dry-run` 或 `--execute` 后才发请求；逐批提交、失败停止，默认只处理 1 批。
- `integrations/wenchao/integration.test.mjs`：载入真实现有 Worker，在本地隔离的 provider/绑定替身下验证新增路由和建库。
- `integrations/wenchao/daan-dry-run.json`：本次实际本地盘点结果。

从 Lotus 目录运行：

```bash
node --test integrations/wenchao/integration.test.mjs
node integrations/wenchao/prepare.mjs
node --check integrations/wenchao/prepared/worker.js
node integrations/wenchao/prepare-daan.mjs
```

补丁产物位于 `integrations/wenchao/prepared/lotus-retrieval.patch`；同目录 `source-evidence.json` 保存源文件 hash。`prepared/` 与含全文的 `daan-prepared/` 均在该集成目录的 `.gitignore` 中。

## 大安资料范围与实际 dry-run

现有原始资料在 `/Users/bincai/Downloads/foyue/foyue01/大安法师（讲法集）TXT`。现有 `scripts/build-library.py` 已把 doc/docx/多编码 txt 转成 `public/text/**` 并生成 `public/library.json`；Lotus 读取这些已经处理好的文件，不再执行会全量删除重建 `public/text` 的旧构建脚本。

本次读取的索引生成日为 2026-08-15，SHA-256 为 `696d7c2bbd2aeab4754efe6bd4bbc3b7a1ec3544102b8864a7b24a4d2999ac61`。2026-09-13 本地检查得到：

- 纳入 1061 篇（讲记、单篇开示与 820 则问答），15529 个非空自然行段落，5160988 字符。
- 复用现有 `chunksOf` 得到 18006 个切块，可分 133 个请求批次。
- 排除 `jing` 系列 14 篇：经典、仪轨、印祖序跋等不属于大安讲记。
- 校验全部本地文章的身份、路径、正文与切块；没有支付嵌入费用，也没有远程写入。

内容哈希覆盖适配后的原文段落拼接，另保留源 txt 文件哈希。适配器仅统一换行、去每行首尾空白和空行，不改写讲记用词。尚未逐份比对原 doc/docx 与现有 txt，也没有把本地结构校验称作教理审校。

## 应用和建库步骤（尚未执行）

先审查补丁和源 hash。确认需要应用后，在 `wenchao` 目录检查与应用：

```bash
git apply --check ../Lotus/integrations/wenchao/prepared/lotus-retrieval.patch
git apply ../Lotus/integrations/wenchao/prepared/lotus-retrieval.patch
```

保留原有绑定和 Secrets；新增代码仍使用原配置。部署使用现有项目的 `workers/ai-proxy/wrangler.toml`，部署前按项目发布流程验证；此文档不表示已经部署。

本地准备请求文件：

```bash
node integrations/wenchao/prepare-daan.mjs --out integrations/wenchao/daan-prepared
```

在进程环境设置 `WENCHAO_INDEX_SECRET`，不要把密钥写入源代码、聊天或请求文件。端点准备好后可先对单批远程校验：

```bash
node integrations/wenchao/submit-daan.mjs --dry-run --limit 1
```

`--dry-run` 调用建库端点的校验与切块分支，不调用嵌入、不创建表、不写入 D1/Vectorize。实际入库必须显式改为 `--execute`；使用 `--from`、`--limit` 控制范围并在失败处重试。所有批次完成后再抽样核验两库召回、角色标签、正文一致和可访问来源链接。

大安建库是增量流程，绝不调用旧 `/index?cursor=0`（该旧路径会 DROP 原文钞全文表）。同底本重试使用相同向量 id，并替换该篇 FTS 行；不同底本 hash 返回 409，必须先审查替换迁移。提交应串行执行，不能并发操作同篇。D1 与 Vectorize 不是一笔事务，因此篇目状态先标记 `pending`，完整完成后才为 `ready`；检索排除 pending 篇目。初次建库中断可能留有不可见的向量，继续同底本重试即可。

## 验证证据与未完成范围

本地集成测试已通过，覆盖服务端鉴权、调用路径、RRF/重排复用、严格 namespace 隔离、两库身份标签、默认不调用回答模型、可选查询改写、长段父上下文降级、不可用与零命中的区别、pending 资料隐藏、建库 dry-run 无写入、同底本重试和不同底本冲突，以及全部 1061 篇本地资料的适配校验。准备后的完整 Worker 通过 `node --check`。

这些验证使用真实 Worker 源码与本地绑定替身；没有证明当前远端 D1/Vectorize 的内容或健康状态，没有执行真实 provider 调用、生产检索、远程建库或公开链接抽查。纯检索端点应用并部署、服务端 key 配置和大安入库完成后，Lotus 才能取得这两库的在线检索证据。
