# Obsidian Better Command Palette — 项目总体架构文档

> 目标读者：初级工程师 / 其他 AI
> 目的：快速建立整体心智模型，知道每个模块做什么、去哪里改代码

---

## 1. 项目简介

Better Command Palette 是一个 Obsidian 插件，用来替换/增强 Obsidian 内置的命令面板。

**一句话总结：** 内置命令面板只能搜命令，而这个插件在同一个弹窗里集成了**命令搜索 + 文件搜索 + 标签搜索**，并加入了最近使用记录、隐藏项、宏命令等功能。

**技术栈：**

| 技术 | 用途 |
|------|------|
| TypeScript | 主要开发语言 |
| Obsidian Plugin API | 弹窗基类、命令注册、文件访问 |
| fuzzysort | 模糊搜索算法（唯一运行时依赖） |
| Web Worker | 异步模糊搜索，不阻塞 UI |
| SCSS | 插件样式 |
| Rollup | 打包 |

---

## 2. 目录结构

```
obsidian-better-command-palette/
├── src/
│   ├── main.ts                              # 插件入口，生命周期，宏命令注册
│   ├── palette.ts                           # 主弹窗组件（核心 UI）
│   ├── settings.ts                          # 设置界面 + 设置类型定义
│   │
│   ├── palette-modal-adapters/              # 三种搜索模式的具体实现
│   │   ├── command-adapter.ts               # 命令搜索
│   │   ├── file-adapter.ts                  # 文件搜索 + 文件创建
│   │   ├── tag-adapter.ts                   # 标签搜索
│   │   └── index.ts                         # 统一导出
│   │
│   ├── utils/
│   │   ├── suggest-modal-adapter.ts         # 三种适配器的抽象基类
│   │   ├── ordered-set.ts                   # 最近使用记录的数据结构
│   │   ├── palette-match.ts                 # Match 接口的通用实现
│   │   ├── macro.ts                         # 宏命令执行逻辑
│   │   ├── utils.ts                         # 工具函数（快捷键渲染、文件操作等）
│   │   ├── constants.ts                     # 查询运算符、修饰键图标常量
│   │   ├── settings-command-suggest-modal.ts# 设置页里选择命令用的弹窗
│   │   └── index.ts                         # 统一导出
│   │
│   ├── web-workers/
│   │   └── suggestions-worker.ts            # Web Worker：后台执行模糊搜索
│   │
│   ├── types/
│   │   ├── types.d.ts                       # 类型定义 + 非公开 Obsidian API 的类型声明
│   │   └── worker.d.ts                      # Web Worker 通信类型
│   │
│   └── styles.scss                          # 插件 CSS
│
├── test/                                    # E2E 测试
├── manifest.json                            # Obsidian 插件清单
└── package.json
```

---

## 3. 核心模块

### 模块 1：插件入口（main.ts）

**职责：** 插件初始化、命令注册、宏命令管理。

**注册的 Obsidian 命令：**

| 命令 ID | 功能 | 默认快捷键 |
|---------|------|-----------|
| `open-better-command-palette` | 打开命令模式 | Cmd+Shift+P |
| `open-better-command-palette-file-search` | 直接打开文件模式 | 无默认 |
| `open-better-command-palette-tag-search` | 直接打开标签模式 | 无默认 |

**宏命令管理：**
- 启动时：`loadMacroCommands()` 把用户配置的宏注册为 Obsidian 命令
- 设置变更时：`deleteMacroCommands()` + `loadMacroCommands()` 重新加载
- 宏命令 ID 格式：`obsidian-better-command-palette-macro-N`

**Web Worker 创建：**
- 在插件加载时创建 `suggestionsWorker`
- 所有模糊搜索在 Worker 里异步执行，不阻塞 UI

---

### 模块 2：主弹窗（palette.ts）

**职责：** 弹窗 UI、用户输入处理、搜索模式切换、键盘交互。

这是整个插件的"指挥中心"，继承自 Obsidian 的 `SuggestModal<Match>`。

**三种搜索模式（ActionType）：**

```typescript
enum ActionType {
  Commands = 'COMMANDS',  // 默认，搜索命令
  Files = 'FILES',        // 输入 '/' 前缀触发
  Tags = 'TAGS',          // 输入 '#' 前缀触发
}
```

**模式切换逻辑（`updateActionType()`）：**

```
用户输入 '/'  → 切换到文件搜索模式（fileAdapter 接管）
用户输入 '#'  → 切换到标签搜索模式（tagAdapter 接管）
其他输入      → 命令搜索模式（commandAdapter 接管）
前缀消失时    → 自动切回命令模式
```

**关键方法：**

| 方法 | 作用 |
|------|------|
| `updateActionType()` | 根据输入前缀自动切换模式 |
| `changeActionType()` | 通过快捷键手动切换模式 |
| `getSuggestions()` | 把搜索任务发给 Web Worker |
| `receivedSuggestions()` | 接收 Worker 结果，按最近使用排序 |
| `renderSuggestion()` | 渲染每条搜索结果 |
| `onChooseSuggestion()` | 用户选中结果后的处理 |
| `setScopes()` | 注册键盘快捷键 |

---

### 模块 3：三种搜索适配器（palette-modal-adapters/）

三种搜索模式各有一个"适配器"类，都继承自同一个抽象基类 `SuggestModalAdapter`。

**抽象基类的通用能力（suggest-modal-adapter.ts）：**

```typescript
abstract class SuggestModalAdapter {
  allItems: Match[]        // 全部可搜索项
  pinnedItems: Match[]     // 置顶项（仅命令模式有）
  prevItems: OrderedSet    // 最近使用记录
  hiddenIds: string[]      // 被隐藏的项的 ID 列表

  // 每个子类必须实现：
  abstract renderSuggestion(match, el): void  // 如何渲染一条结果
  abstract onChooseSuggestion(match, event): void  // 选中后执行什么

  // 基类提供的通用方法：
  getSortedItems()   // 返回：最近使用 + 置顶的项（排在前面）
  toggleHideId()     // 隐藏/显示某一项，并持久化到设置
  mount()            // 注册键盘快捷键（切换模式等）
  unmount()          // 注销快捷键
}
```

#### 命令适配器（command-adapter.ts）

| 属性/方法 | 说明 |
|-----------|------|
| `allItems` | `app.commands.commands` 里的所有命令 |
| `pinnedItems` | 从内置命令面板的置顶列表读取 |
| `prevItems` | `plugin.prevCommands`（插件全局维护） |
| `renderSuggestion()` | 显示：插件名 + 命令名 + 快捷键 + 置顶图标 |
| `onChooseSuggestion()` | 记录到最近使用，然后执行命令 |

#### 文件适配器（file-adapter.ts）

| 属性/方法 | 说明 |
|-----------|------|
| `allItems` | vault 里所有文件（按扩展名过滤后） |
| `prevItems` | `app.workspace.getLastOpenFiles()` |
| `renderSuggestion()` | 显示：文件名 + 路径（未解析链接显示为灰色） |
| `onChooseSuggestion()` | 打开文件（支持当前窗格/新窗格）或创建文件 |

#### 标签适配器（tag-adapter.ts）

| 属性/方法 | 说明 |
|-----------|------|
| `allItems` | `app.metadataCache.getTags()` 里的所有标签 |
| `prevItems` | `plugin.prevTags` |
| `renderSuggestion()` | 显示：标签名 + 使用该标签的文件数量 |
| `onChooseSuggestion()` | 重新打开面板，进入文件模式并按该标签过滤 |

---

### 模块 4：Web Worker（suggestions-worker.ts）

**职责：** 在后台线程执行模糊搜索，不阻塞 UI。

**通信方式：**

```
主线程 → Worker:  { query: string, items: Match[] }
Worker → 主线程:  { items: Match[] }  （已排序的搜索结果）
```

**Worker 内部处理流程：**

```
1. 接收 query 和 items
2. 用 '@' 分割 query → 主查询词 + 标签过滤条件
   示例: "obsidian@plugin@tool" → 主查询="obsidian", 标签=["plugin","tool"]
3. 若主查询含 '||' → OR 模式（满足任一即命中）
   示例: "git || github"
4. 否则 → 用 fuzzysort 做模糊匹配
5. 按标签过滤（如果有）
6. 返回排序后的结果
```

---

### 模块 5：最近使用记录（ordered-set.ts）

**职责：** 维护一个有序、无重复的最近使用列表。

```typescript
class OrderedSet<T> {
  add(item: T)             // 若已存在则先删除再插入末尾（移到最近）
  has(item: T): boolean
  valuesByLastAdd(): T[]   // 返回按最后添加时间倒序的列表（最近在前）
  serialize(): string[]    // 转为字符串数组（用于持久化）
}
```

**使用场景：**
- `plugin.prevCommands` — 最近执行的命令
- `plugin.prevTags` — 最近搜索的标签
- 文件的最近记录直接用 `app.workspace.getLastOpenFiles()`（Obsidian 内置）

---

### 模块 6：宏命令（macro.ts）

**职责：** 把多个 Obsidian 命令串联成一个"宏"，支持步骤间延迟。

```typescript
class MacroCommand implements Command {
  commandIds: string[]   // 要按顺序执行的命令 ID 列表
  delay: number          // 步骤间延迟（毫秒）

  checkCallback(checking: boolean) {
    // 若 checking=true，只检查第一个命令是否可用，不执行
    // 若 checking=false，依次执行所有命令
  }

  callAllCommands() {
    // 用 setTimeout 实现延迟执行
    // 每一步前先检查命令是否仍可用，若不可用则停止
  }
}
```

---

### 模块 7：设置系统（settings.ts）

**设置存储位置：** Obsidian 的 `data.json`（通过 `plugin.saveData()` / `loadData()`）

**主要设置项：**

| 设置项 | 类型 | 说明 |
|--------|------|------|
| `closeWithBackspace` | boolean | 输入框为空时按 Backspace 关闭面板 |
| `showPluginName` | boolean | 命令列表中显示插件名 |
| `fileSearchPrefix` | string | 文件搜索前缀（默认 `/`） |
| `tagSearchPrefix` | string | 标签搜索前缀（默认 `#`） |
| `suggestionLimit` | number | 最多显示多少条结果（10-1000，默认50） |
| `recentAbovePinned` | boolean | 最近使用是否排在置顶项之前 |
| `hotkeyStyle` | auto/mac/windows | 快捷键显示风格 |
| `macros` | MacroCommandInterface[] | 用户创建的宏命令列表 |
| `hiddenCommands` | string[] | 被隐藏的命令 ID 列表 |
| `hiddenFiles` | string[] | 被隐藏的文件路径列表 |
| `hiddenTags` | string[] | 被隐藏的标签列表 |
| `fileTypeExclusion` | string[] | 文件搜索中排除的扩展名（如 `pdf,jpg`） |
| `createNewFileMod` | Modifier | 创建新文件的修饰键（Mod 或 Shift） |
| `createNewPaneMod` | Modifier | 在新窗格打开的修饰键 |

---

## 4. 模块间依赖关系

```
┌──────────────────────────────────────────────────────────────┐
│  main.ts（插件主控）                                           │
│  - 创建 BetterCommandPaletteModal 实例                        │
│  - 注册命令 & 宏命令                                           │
│  - 持有 prevCommands、prevTags（最近使用记录）                  │
│  - 持有 suggestionsWorker                                     │
└──────────┬───────────────────────────────────────────────────┘
           │ 创建并传入 plugin 引用
     ┌─────▼──────────────────────────────────────────────┐
     │  palette.ts（主弹窗）                               │
     │  - 根据输入前缀切换 actionType                      │
     │  - 将搜索任务发给 Web Worker                        │
     │  - 接收结果并渲染                                   │
     └──┬──────────┬──────────┬──────────────────────────┘
        │          │          │ 持有三个适配器，按模式切换激活
  ┌─────▼──┐ ┌────▼───┐ ┌────▼────┐
  │Command  │ │ File   │ │  Tag    │
  │Adapter  │ │Adapter │ │Adapter  │
  └─────────┘ └────────┘ └─────────┘
       共同继承
  ┌─────────────────────────┐
  │ SuggestModalAdapter     │
  │ (抽象基类)               │
  │ - allItems              │
  │ - prevItems (OrderedSet)│
  │ - hiddenIds             │
  └─────────────────────────┘

  ┌──────────────────────────────────────────────────┐
  │  Web Worker (suggestions-worker.ts)              │
  │  - 接收 query + items                            │
  │  - fuzzysort 模糊搜索                             │
  │  - 支持 OR 查询、标签过滤                          │
  │  - 返回排序后的结果                                │
  └──────────────────────────────────────────────────┘

  ┌──────────────────┐   ┌──────────────────────┐
  │ OrderedSet       │   │ MacroCommand         │
  │ - 最近使用记录   │   │ - 串联执行命令        │
  └──────────────────┘   └──────────────────────┘
```

---

## 5. 数据流：从用户输入到显示结果

```
用户在输入框打字
  │
  ▼
palette.ts: getSuggestions(query)
  │
  ├─ updateActionType()：检测前缀，必要时切换适配器
  │
  ▼
currentAdapter.getSortedItems()
  → 返回：最近使用 + 置顶项（固定排在前面，不参与模糊搜索）
  + allItems（剩余全部项，参与模糊搜索）
  │
  ▼
postMessage 到 Web Worker：{ query, items }
  │
  ▼  （后台线程执行，不阻塞 UI）
suggestions-worker.ts:
  1. 解析 query：主词、OR条件、标签过滤
  2. fuzzysort 模糊匹配
  3. 标签过滤
  4. 返回排序结果
  │
  ▼
palette.ts: receivedSuggestions(results)
  │
  ├─ 最近使用的项提到最前面
  ├─ 过滤隐藏项（除非 showHiddenItems=true）
  ├─ 限制数量（suggestionLimit）
  │
  ▼
renderSuggestion() × N  （当前适配器负责渲染每一条）
  │
  ▼
用户看到结果列表
```

---

## 6. 选中结果后的数据流

```
用户按 Enter 或点击某条结果
  │
  ▼
palette.ts: onChooseSuggestion(match, event)
  → 转发给 currentAdapter.onChooseSuggestion()
  │
  ├─ 命令模式：
  │   → 记录到 prevCommands（移到最近使用列表头部）
  │   → app.commands.executeCommandById(match.id)
  │   → 关闭弹窗
  │
  ├─ 文件模式：
  │   → 按修饰键决定行为：
  │       普通 Enter   → 在当前窗格打开文件
  │       createNewPaneMod+Enter → 在新窗格打开
  │       createNewFileMod+Enter → 创建新文件
  │   → 关闭弹窗
  │
  └─ 标签模式：
      → 记录到 prevTags
      → 重新打开面板，切换到文件模式，并预填 '#tag名'
      （面板不关闭，而是立即重开，继续缩小范围）
```

---

## 7. 键盘快捷键一览

| 快捷键 | 触发条件 | 功能 |
|--------|----------|------|
| `Cmd+Shift+P` | 任意时候 | 打开面板（命令模式） |
| `Backspace`（输入框为空） | 面板打开中 | 关闭面板（可配置） |
| `Mod+I` | 面板打开中 | 切换"显示/隐藏 已隐藏项" |
| `Mod+[fileSearchHotkey]` | 面板打开中 | 切换到文件搜索模式 |
| `Mod+[tagSearchHotkey]` | 面板打开中 | 切换到标签搜索模式 |
| `Mod+[commandSearchHotkey]` | 面板打开中 | 切换回命令模式 |
| `Cmd+Enter` 或 `Shift+Enter` | 文件模式 | 创建文件 / 新窗格打开（可配置哪个键对应哪个操作） |
| `Mod+L` | 文件模式 | 把选中文件的路径粘贴到输入框 |

---

## 8. 搜索语法

在输入框里可以使用特殊语法：

| 语法 | 示例 | 效果 |
|------|------|------|
| 普通文字 | `obsidian plugin` | 模糊匹配 |
| 文件前缀 | `/project notes` | 切换到文件搜索 |
| 标签前缀 | `#javascript` | 切换到标签搜索 |
| OR 查询 | `git \|\| github` | 命中包含 git 或 github 的项 |
| 标签过滤 | `notes@javascript` | 搜索 notes，同时要求含 #javascript 标签 |
| 组合 | `/readme@project` | 文件模式下，搜 readme 且含 #project 标签 |

---

## 9. 开发扩展指南

### 新增一种搜索模式

1. 在 `src/palette-modal-adapters/` 创建新的适配器类，继承 `SuggestModalAdapter`
2. 实现 `renderSuggestion()` 和 `onChooseSuggestion()` 两个抽象方法
3. 在 `palette.ts` 中增加新的 `ActionType` 枚举值
4. 在 `updateActionType()` 中添加前缀检测逻辑
5. 在 `setScopes()` 中注册切换快捷键

### 修改搜索排序逻辑

- 主要逻辑在 `palette.ts` 的 `receivedSuggestions()` 方法
- 最近使用排序在此处实现（把 prevItems 里的项移到最前面）
- 模糊搜索的排序在 `suggestions-worker.ts` 里（fuzzysort 默认按相关度排序）

### 修改结果渲染样式

- 各适配器的 `renderSuggestion()` 方法控制如何渲染
- CSS 类名定义在 `styles.scss`
- 常用类名：`.suggestion-title`、`.suggestion-note`、`.suggestion-hotkey`、`.recent`、`.hidden`

### 新增宏命令功能

- 宏的执行逻辑在 `src/utils/macro.ts`
- 宏的设置 UI 在 `src/settings.ts`
- 宏的数据类型在 `src/types/types.d.ts` 的 `MacroCommandInterface`

---

## 10. 关键类型定义

```typescript
// 每条搜索结果的统一结构
interface Match {
  text: string    // 显示文字（命令名/文件名/标签名）
  id: string      // 唯一标识（命令ID/文件路径/标签名）
  tags: string[]  // 关联元数据（文件的标签、命令的分组等）
}

// 宏命令配置
interface MacroCommandInterface {
  name: string          // 宏的显示名称
  commandIds: string[]  // 按顺序执行的命令 ID
  delay: number         // 步骤间延迟（毫秒）
}

// ActionType 枚举
enum ActionType {
  Commands = 'COMMANDS',
  Files    = 'FILES',
  Tags     = 'TAGS',
}

// 设置
interface BetterCommandPalettePluginSettings {
  closeWithBackspace: boolean
  showPluginName: boolean
  fileSearchPrefix: string       // 默认 '/'
  tagSearchPrefix: string        // 默认 '#'
  suggestionLimit: number        // 默认 50
  recentAbovePinned: boolean
  hotkeyStyle: 'auto'|'mac'|'windows'
  macros: MacroCommandInterface[]
  hiddenCommands: string[]
  hiddenFiles: string[]
  hiddenTags: string[]
  fileTypeExclusion: string[]
  createNewFileMod: Modifier
  createNewPaneMod: Modifier
}
```
