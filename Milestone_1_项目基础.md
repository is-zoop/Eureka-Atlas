# Milestone 1 项目基础

## 1. 目标

建立 Eureka Atlas 数据治理中心的基础工程架构。

本阶段目标：

-   初始化前端项目
-   初始化后端项目
-   配置 PostgreSQL
-   配置 Prisma
-   建立 Monorepo 工程结构
-   建立基础模块目录

本阶段不实现业务功能。

------------------------------------------------------------------------

# 2. 项目定位

项目名称：

产品名：

    Eureka Atlas

代码仓库：

    eureka-atlas

定位：

企业数据语义治理平台。

长期路线：

    数据治理中心
            ↓
    Semantic Package
            ↓
    PI SDK Agent
            ↓
    Query Agent SDK
            ↓
    Eureka

当前 Milestone 只负责基础工程。

------------------------------------------------------------------------

# 3. 技术栈

## 3.1 前端

使用：

    Next.js 16+
    React
    TypeScript
    Tailwind CSS
    shadcn/ui

职责：

-   页面展示
-   用户交互
-   调用 Backend API

禁止：

-   前端直接访问数据库
-   前端直接调用 LLM

------------------------------------------------------------------------

## 3.2 后端

使用：

    NestJS
    TypeScript
    Prisma
    PostgreSQL

职责：

-   业务 API
-   数据访问
-   数据治理流程
-   AI能力封装

------------------------------------------------------------------------

## 3.3 数据库

使用：

    PostgreSQL

用途：

保存：

-   元数据
-   治理任务
-   语义资产
-   Semantic Package

不保存：

-   ODPS业务数据

------------------------------------------------------------------------

# 4. 工程结构

采用 Monorepo。

    eureka-atlas

    ├── apps
    │
    │   ├── web
    │   │
    │   │   ├── app
    │   │   ├── components
    │   │   ├── hooks
    │   │   ├── lib
    │   │   └── styles
    │   │
    │   └── api
    │       │
    │       └── src
    │           │
    │           ├── common
    │           ├── datasource
    │           ├── metadata
    │           ├── governance
    │           ├── semantic
    │           ├── package
    │           ├── llm
    │           └── rule
    │
    ├── packages
    │
    │   ├── database
    │   │   └── prisma
    │   │
    │   ├── types
    │   │
    │   └── config
    │
    ├── docker-compose.yml
    ├── package.json
    └── README.md

------------------------------------------------------------------------

# 5. 目录职责

## apps/web

Next.js 前端。

未来页面：

    assets
    governance
    semantic
    rules

------------------------------------------------------------------------

## apps/api

NestJS 后端。

模块：

### datasource

数据源管理。

### metadata

元数据管理。

负责：

    DataWorks
        ↓
    meta_table
    meta_column

### governance

治理流程。

负责：

-   创建治理任务
-   AI治理
-   审核发布

### semantic

语义资产。

负责：

    table_semantic
    column_semantic

### package

Semantic Package生成。

### llm

模型能力。

负责：

-   Prompt管理
-   模型调用
-   JSON解析

### rule

治理规则。

------------------------------------------------------------------------

# 6. Prisma目录

位置：

    packages/database/prisma

结构：

    prisma

    ├── schema.prisma
    ├── migrations
    └── seed.ts

------------------------------------------------------------------------

# 7. 环境配置

环境变量：

    .env

不提交代码仓库。

示例：

``` env
DATABASE_URL=

ODPS_ACCESS_KEY=

ODPS_SECRET_KEY=

LLM_API_KEY=
```

------------------------------------------------------------------------

# 8. 后端代码规范

每个 NestJS 模块：

    module.ts

    controller.ts

    service.ts

    dto/

------------------------------------------------------------------------

# 9. 前端代码规范

组件：

    components

    ├── ui
    ├── table
    ├── governance
    └── semantic

原则：

-   页面负责组合
-   组件负责展示
-   API统一封装

------------------------------------------------------------------------

# 10. 本阶段禁止事项

Milestone 1 不实现：

-   Agent
-   PI SDK
-   RAG
-   Embedding
-   SQL生成
-   权限系统
-   数据质量
-   血缘
-   微服务拆分

------------------------------------------------------------------------

# 11. Milestone 1 验收标准

## 项目启动

完成：

-   前端可以启动
-   后端可以启动

## 数据库

完成：

-   PostgreSQL连接成功
-   Prisma初始化成功

## 工程结构

完成：

-   Monorepo结构
-   基础目录
-   README
-   环境变量说明

## 输出要求

Codex完成后输出：

1.  项目目录结构
2.  启动方式
3.  已完成内容
4.  遇到的问题
5.  下一步开发建议
