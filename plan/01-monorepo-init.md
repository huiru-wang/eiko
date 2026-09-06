# Task 1: Monorepo 项目初始化

> 依赖：无
> 后续：[02-hono-pi-backend.md](./02-hono-pi-backend.md) | [前端设计](../docs/frontend/design.md)

## 目标

搭建 pnpm workspaces Monorepo 根目录结构，创建必要的根级配置文件和共享类型包。前后端工程目录先创建为空目录骨架，不做具体实现。

## 步骤

### 1.1 根目录配置文件

在 `eiko/` 根目录创建：

**`pnpm-workspace.yaml`**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**`package.json`**
```jsonc
{
  "name": "eiko",
  "private": true,
  "packageManager": "pnpm@10.11.0",
  "scripts": {
    "dev:server": "pnpm --filter @eiko/server start",
    "dev:frontend": "pnpm --filter @eiko/h5 dev",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  }
}
```

**`tsconfig.base.json`**
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**`.gitignore`**
```text
node_modules/
dist/
.env
*.sqlite
*.sqlite-journal
*.sqlite-wal
logs/
.sessions/
workspaces/
*.tsbuildinfo
.DS_Store
```

**`.npmrc`**
```text
shamefully-hoist=false
strict-peer-dependencies=false
```

**`.editorconfig`**
```text
root = true
[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

### 1.2 创建 `packages/shared`

**`packages/shared/package.json`**
```jsonc
{
  "name": "@eiko/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

**`packages/shared/tsconfig.json`**
```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

**`packages/shared/src/index.ts`**
```ts
export * from './api/response.js';
export * from './models/record.js';
export * from './models/topic.js';
export * from './models/message.js';
export * from './constants.js';
```

**`packages/shared/src/api/response.ts`**
```ts
export type ApiResponse<T> = {
  result: T;
  success: boolean;
  errorCode: string | null;
  errorMsg: string | null;
};

export type PaginatedResult<T> = {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  pageSize: number;
};
```

**`packages/shared/src/models/record.ts`**
```ts
export type RecordStatus = 'pending' | 'processing' | 'digested';

export type RecordView = {
  id: string;
  text: string;
  status: RecordStatus;
  topics: Array<{ id: string; title: string }>;
  occurredAt: string;
};
```

**`packages/shared/src/models/topic.ts`**
```ts
export type TopicView = {
  id: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  needsOrganize: boolean;
  relatedRecords: Array<{ id: string; text: string; occurredAt: string }>;
  sessionId: string;
  updatedAt: string;
};

export type TopicActionType = 'merge_insight' | 'correct' | 'reorganize';

export type TopicAction = {
  id: string;
  type: TopicActionType;
  content: string;
  createdAt: string;
};
```

**`packages/shared/src/models/message.ts`**
```ts
export type MessageRole = 'user' | 'assistant' | 'toolResult';

export type MessageView = {
  id: number;
  sessionId: string;
  topicId: string;
  role: MessageRole;
  content: unknown;
  timestamp: number;
};
```

**`packages/shared/src/constants.ts`**
```ts
export const RECORD_SOURCE = { HOME: 'home' } as const;
export const RECORD_STATUS = { PENDING: 'pending', PROCESSING: 'processing', DIGESTED: 'digested' } as const;
export const TOPIC_STATUS = { ACTIVE: 'active', ARCHIVED: 'archived' } as const;
```

### 1.3 创建前后端空目录骨架

**`apps/server/`** -- 仅创建目录结构和占位 package.json：
```text
apps/server/
├── package.json       # name: @eiko/server（仅 name + version + private）
├── tsconfig.json      # extends base
└── src/               # 空目录
```

**`apps/h5/`** -- 独立 H5 工程：
```text
apps/h5/
├── package.json       # name: @eiko/h5
├── tsconfig.json      # extends base
└── src/
```

### 1.4 创建辅助目录

```text
data/                  # SQLite 数据库文件存放目录
scripts/               # 工程脚本
```

### 1.5 验证

```bash
pnpm install          # workspace 解析正常
pnpm typecheck        # shared 包类型检查通过
```
