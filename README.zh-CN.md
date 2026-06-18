# AI Workflow Observer

面向真实 AI 编码工作流的隐私优先观测系统。

AI Workflow Observer 帮助团队判断 AI 编码工具是否真的降低了工作摩擦。它会从 Cursor 这类工具本地采集使用信号，归一化为任务、轮次、纠正事件和摩擦事件，再上传经过隐私控制的指标，用于团队级分析。

它不是模型 benchmark，也不是员工绩效排名系统。

## 为什么做这个项目

企业里很多 AI 生产力评估，依赖问卷和拍脑袋估算。只要团队在切换工具、模型、prompt 或内部 agent，这些信号就会变得很弱。

AI Workflow Observer 关注的是真实使用过程：

- 一个任务需要多少个用户轮次
- 用户纠正 AI 多少次
- 哪些任务类型更容易产生摩擦
- 工具或模型迁移后，工作是否更顺畅
- 哪些部门或 cohort 适合迁移

第一批目标场景是比较 Cursor 现状与 opencode 或 in-house 模型 rollout。

## 它测什么

系统把数据分成三层：

- `rawMessages`：源级消息或 Cursor bubble，用于审计和调试
- `turns`：连续同角色消息合并后的用户可感知轮次
- `tasks`：从会话或 composer 归纳出来的任务候选

核心指标包括：

- `completionRate`
- `averageUserTurnsPerTask`
- `averageAssistantTurnsPerTask`
- `averageCorrectionsPerTask`
- `frictionEventCount`
- `taskType`
- `complexity`
- `departmentId`
- `sourceTool`
- `modelName`
- `migrationCohort`

## 架构

```text
Cursor / opencode / Copilot
        |
        v
本地 collector
        |
        v
隐私过滤
        |
        v
Ingestion API
        |
        v
先写 JSONL，后续可换 Postgres / ClickHouse
        |
        v
BI / 迁移报告
```

当前包含的包：

- `apps/collector-cli`：本地采集器和上传器
- `apps/ingestion-api`：最小化的私有接入服务
- `packages/cursor-adapter`：Cursor 存储发现与会话抽取
- `packages/evaluator`：任务、轮次、纠正和摩擦启发式分析
- `packages/git-adapter`：仓库状态采集
- `packages/privacy`：脱敏和哈希策略
- `packages/schema`：共享数据合同

## 当前状态

这是一个早期 POC，但已经支持：

- Cursor 本地存储发现
- Cursor SQLite 快照读取
- 当前 Cursor `composerData` 和 `bubbleId` 抽取
- raw message 到 logical turn 的合并
- 启发式任务与纠正检测
- 部门 key 接入
- 文本和路径的隐私模式
- tool / model / team / repo cohort 元数据

目前还没有：

- MCP server 模式
- 后台 daemon 模式
- 生产级数据库写入器
- in-house 模型评估 worker
- 完整的 Cursor / Copilot / opencode 适配覆盖

## 快速开始

安装依赖：

```sh
pnpm install
pnpm build
```

采集一份本地 Cursor 数据：

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --python-sqlite-command python3 \
  --text-mode redacted \
  --path-mode basename \
  --no-raw-messages \
  --pretty \
  --output tmp-collector-run.json
```

如果系统有 `sqlite3` CLI，也可以这样运行：

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --sqlite-command sqlite3 \
  --text-mode redacted \
  --path-mode basename \
  --no-raw-messages \
  --pretty
```

## 隐私

隐私是在本地评估之后再应用的。这样可以先在本机提取任务和摩擦指标，再减少离开员工机器的数据量。

文本模式：

```text
raw       保留原文
redacted  用长度标记替换
hash      用确定性哈希和长度替换
```

路径模式：

```text
raw       保留完整路径
basename  仅保留 basename
hash      用确定性哈希替换路径
```

推荐试点默认值：

```sh
AWO_TEXT_MODE=redacted
AWO_PATH_MODE=basename
AWO_INCLUDE_RAW_MESSAGES=false
```

见 [docs/privacy.md](docs/privacy.md)。

## 接入

启动带部门 key 的 ingestion API：

```sh
export AWO_DEPARTMENT_KEYS='engineering:eng_key,product:prd_key,design:dsn_key,data:data_key,ops:ops_key,support:sup_key'
PORT=3010 AWO_DATA_DIR=./data pnpm ingestion
```

使用 `curl` 上传：

```sh
curl -X POST http://127.0.0.1:3010/v1/collector-runs \
  -H 'content-type: application/json' \
  -H 'x-awo-department-key: eng_key' \
  --data-binary @tmp-collector-run.json
```

或者直接采集并上传：

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --python-sqlite-command python3 \
  --text-mode redacted \
  --path-mode basename \
  --no-raw-messages \
  --source-tool cursor \
  --model-provider anthropic \
  --model-name claude-sonnet \
  --team-id backend \
  --repo-id repo-api \
  --migration-cohort cursor-baseline \
  --upload-url http://127.0.0.1:3010/v1/collector-runs \
  --department-key eng_key \
  --output tmp-collector-run.json
```

服务端只保存 `departmentId` 和 `keyId`，不会保存原始 key。

见 [docs/ingestion.md](docs/ingestion.md)。

## 工具和模型对比

AI Workflow Observer 比较的是匹配后的工作流 cohort，不应该被当成直接的模型 benchmark。

适合对比的 cohort 字段：

- `sourceTool`
- `toolVersion`
- `modelProvider`
- `modelName`
- `modelVersion`
- `departmentId`
- `teamId`
- `repoId`
- `taskType`
- `complexity`
- `migrationCohort`

对比时要按部门、团队、仓库、任务类型、复杂度和时间窗口做匹配。

见 [docs/comparison.md](docs/comparison.md)。

## 开发

```sh
pnpm install
pnpm build
pnpm collector -- --repo . --python-sqlite-command python3 --text-mode redacted --path-mode basename --no-raw-messages --output tmp-collector-run.json
```

## 项目名

推荐的开源名称是 **AI Workflow Observer**。

这个名字足够准确，能表达“观测真实 AI 工作流”；也足够宽，能支持 Cursor、opencode、Copilot 和后续工具；同时不会把项目误导成传统模型 benchmark。

## 许可证

MIT
