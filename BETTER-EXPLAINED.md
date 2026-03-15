# 为什么叫 Better？— 核心功能深度解析

> 目标读者：想理解"Better 在哪里"以及核心机制实现原理的工程师
> 本文聚焦：与原版命令面板的差异、核心功能的代码实现逻辑

---

## 一、它到底 Better 在哪里？

Obsidian 内置命令面板（Command Palette）的局限性：

| 内置命令面板 | Better Command Palette |
|-------------|----------------------|
| 只能搜命令 | 命令 + 文件 + 标签，三合一弹窗 |
| 无使用频率感知，每次都同等显示 | 最近使用的命令/文件自动排到最前 |
| 命令无法隐藏，噪音多 | 可以隐藏不常用的命令，随时恢复 |
| 没有宏，只能一步一步手动操作 | 支持宏命令，把多步操作串成一键 |
| 只能打开已有文件（需另开 Quick Switcher） | 在面板内直接创建新文件 |
| 无高级搜索语法 | 支持 OR 查询、标签过滤 |
| 文件和命令搜索是两个独立弹窗 | 用前缀符号无缝切换，一个弹窗搞定 |
| 快捷键显示不直观 | 用 ⌘⌥⇧ 图标渲染，更清晰 |

**核心哲学：减少上下文切换，把最常用的工作流加速。**

---

## 二、"最近使用排前"是如何实现的

这是 Better 的第一个核心改进。每次使用某个命令/标签，它就被"提升"到列表顶部。

### 数据结构：OrderedSet

**文件：** `src/utils/ordered-set.ts`

```typescript
class OrderedSet<T> {
  private items: Map<string, T>  // key = serialized string

  add(item: T): void {
    const key = JSON.stringify(item)
    // 如果已存在，先删除（从旧位置移走）
    if (this.items.has(key)) {
      this.items.delete(key)
    }
    // 再添加到末尾（Map 保持插入顺序）
    this.items.set(key, item)
  }

  valuesByLastAdd(): T[] {
    // 反转 → 最新添加的在最前面
    return [...this.items.values()].reverse()
  }

  serialize(): string[] {
    return [...this.items.keys()]
  }
}
```

> **关键设计：** 用 `Map` 而不是数组，因为 Map 的插入顺序是稳定的，且删除/重插的操作是 O(1)。`add()` 的语义是"移到最近"，不是"追加"。

### 存储位置

- 命令：`plugin.prevCommands`（`OrderedSet<Command>`，序列化到 `settings.prevCommands`）
- 标签：`plugin.prevTags`（`OrderedSet<string>`，序列化到 `settings.prevTags`）
- 文件：直接用 `app.workspace.getLastOpenFiles()`（Obsidian 内置，不需要自己维护）

### 排序逻辑

**文件：** `src/utils/suggest-modal-adapter.ts` → `getSortedItems()`

```typescript
getSortedItems(): Match[] {
  const prevItemsList = this.prevItems.valuesByLastAdd()  // 最近使用，最新在前

  // 找出既是"最近使用"又是"置顶"的项（两者都提前）
  const recentAndPinned = this.pinnedItems
    .filter(p => prevItemsList.find(r => r.id === p.id))

  if (!this.plugin.settings.recentAbovePinned) {
    // 置顶优先：置顶 → 最近使用 → 其余
    return [...recentAndPinned, ...this.pinnedItems, ...prevItemsList]
  } else {
    // 最近使用优先：最近使用 → 置顶 → 其余
    return [...recentAndPinned, ...prevItemsList, ...this.pinnedItems]
  }
}
```

> 注意：`getSortedItems()` 返回的是"已知重要项"，它们会**固定排在最前面**，不参与后面的模糊搜索排序。模糊搜索只对剩余的普通项生效。

---

## 三、三合一搜索模式是如何切换的

### 前缀检测机制

**文件：** `src/palette.ts` → `updateActionType()`

```typescript
updateActionType(query: string): boolean {
  const { fileSearchPrefix, tagSearchPrefix } = this.plugin.settings
  let newType: ActionType

  if (query.startsWith(fileSearchPrefix)) {  // 默认 '/'
    newType = ActionType.Files
  } else if (query.startsWith(tagSearchPrefix)) {  // 默认 '#'
    newType = ActionType.Tags
  } else {
    newType = ActionType.Commands
  }

  if (newType === this.actionType) return false  // 没变化，不切换

  // 切换适配器
  this.currentAdapter.unmount()   // 注销旧适配器的键盘绑定
  this.actionType = newType
  this.currentAdapter = this.getAdapter(newType)
  this.currentAdapter.mount()     // 注册新适配器的键盘绑定
  return true
}
```

**切换是透明的：** 用户只是打了一个 `/`，背后整个适配器已经换掉了，UI 自动刷新。

### 手动切换（快捷键）

```typescript
// palette.ts → setScopes()
// Mod + fileSearchHotkey → 切换到文件模式
scope.register(['Mod'], settings.fileSearchHotkey, () => {
  this.changeActionType(ActionType.Files)
})
```

`changeActionType()` 不仅切换适配器，还会修改输入框内容（加上/去掉前缀），保持前缀和模式的一致性。

---

## 四、模糊搜索在 Web Worker 里是如何工作的

### 为什么用 Web Worker？

Obsidian 是 Electron 应用（本质是浏览器），JavaScript 是单线程的。如果在主线程做模糊搜索，大型 vault（几千个文件）的搜索会让 UI 卡顿。Web Worker 让搜索在后台线程执行，主线程保持响应。

### 通信流程

**文件：** `src/palette.ts` + `src/web-workers/suggestions-worker.ts`

```
主线程（palette.ts）:
  getSuggestions(query) {
    // 1. 取得所有候选项（已排序的"重要项" + 其余全部）
    const sortedItems = currentAdapter.getSortedItems()
    const remainingItems = allItems.filter(i => !sortedItems.includes(i))
    const items = [...sortedItems, ...remainingItems]

    // 2. 发给 Worker
    suggestionsWorker.postMessage({ query, items })
  }

  // 3. 接收结果（异步回调）
  suggestionsWorker.onmessage = (msg) => {
    this.receivedSuggestions(msg.data.items)
  }
```

```
Worker 线程（suggestions-worker.ts）:
  onmessage = ({ data: { query, items } }) => {
    // 解析 query
    // 执行模糊搜索
    // 返回结果
    postMessage({ items: results })
  }
```

### Worker 内部搜索逻辑

**文件：** `src/web-workers/suggestions-worker.ts`

```typescript
// Step 1：解析 query 中的标签过滤条件
// "search term@tag1@tag2" → 主词 "search term"，标签过滤 ["tag1", "tag2"]
const parts = query.split(AT_OPERATOR)        // AT_OPERATOR = '@'
const mainQuery = parts[0]
const tagFilters = parts.slice(1)

// Step 2：处理 OR 查询
// "git || github" → 命中包含 git 或 github 的项
if (mainQuery.includes(OR_OPERATOR)) {        // OR_OPERATOR = '||'
  const subQueries = mainQuery.split(OR_OPERATOR)
  results = items.filter(item =>
    subQueries.some(q => fuzzysort.single(q.trim(), item.text)?.score > threshold)
  )
} else {
  // Step 3：标准模糊搜索（fuzzysort 库）
  results = fuzzysort.go(mainQuery, items, { key: 'text', threshold: -10000 })
    .map(r => r.obj)
}

// Step 4：标签过滤（如果有 @tag 语法）
if (tagFilters.length > 0) {
  results = results.filter(item =>
    tagFilters.every(filterTag =>
      item.tags.some(itemTag =>
        // 支持嵌套标签：过滤 "project" 时，"project/web" 也算命中
        itemTag === filterTag || itemTag.startsWith(filterTag + '/')
      )
    )
  )
}
```

### 结果回来后的处理

**文件：** `src/palette.ts` → `receivedSuggestions()`

```typescript
receivedSuggestions(suggestions: Match[]) {
  // Worker 返回的结果已经模糊排序
  // 但我们还需要把"最近使用"的项移到最前面
  const prevItems = currentAdapter.prevItems.valuesByLastAdd()

  const recent: Match[] = []
  const rest: Match[] = []

  for (const suggestion of suggestions) {
    if (prevItems.find(p => p.id === suggestion.id)) {
      recent.push(suggestion)
    } else {
      rest.push(suggestion)
    }
  }

  // 最终顺序：最近使用（保持最近顺序）+ 模糊搜索其余结果
  let sorted = [...recent, ...rest]

  // 过滤隐藏项
  if (!this.showHiddenItems) {
    sorted = sorted.filter(s => !currentAdapter.hiddenIds.includes(s.id))
  }

  // 限制数量
  this.currentSuggestions = sorted.slice(0, settings.suggestionLimit)
}
```

---

## 五、隐藏项系统是如何实现的

### 隐藏的本质

"隐藏"不是真正删除。被隐藏的项仍然在 `allItems` 里，只是在显示时被过滤掉。这样可以随时恢复。

### 实现细节

**文件：** `src/utils/suggest-modal-adapter.ts` → `toggleHideId()`

```typescript
toggleHideId(id: string): void {
  const idx = this.hiddenIds.indexOf(id)
  if (idx >= 0) {
    // 已隐藏 → 取消隐藏
    this.hiddenIds.splice(idx, 1)
  } else {
    // 未隐藏 → 隐藏
    this.hiddenIds.push(id)
  }
  // 立即持久化到设置
  this.plugin.saveSettings()
}
```

`hiddenIds` 根据适配器类型，分别存到：
- 命令：`settings.hiddenCommands`
- 文件：`settings.hiddenFiles`
- 标签：`settings.hiddenTags`

### 显示隐藏项的切换

用户按 `Mod+I` 时：

```typescript
// palette.ts → setScopes()
scope.register(['Mod'], 'i', () => {
  this.showHiddenItems = !this.showHiddenItems
  // 重新搜索，这次不过滤隐藏项
  this.updateSuggestions()
})
```

隐藏项显示时会加上 `.hidden` CSS 类，呈现不同样式（颜色较暗），让用户知道这些项是"被隐藏状态"。

### 每条结果旁边的"隐藏按钮"

在 `renderSuggestion()` 里，每条结果会渲染一个点击可以隐藏/取消隐藏的按钮：

```typescript
// 点击 X 图标 → 触发隐藏
const hideBtn = el.createEl('span', { cls: 'suggestion-flair' })
hideBtn.addEventListener('click', (e) => {
  e.stopPropagation()  // 不触发选中
  currentAdapter.toggleHideId(match.id)
  this.updateSuggestions()
})
```

---

## 六、宏命令是如何实现的

### 宏的数据结构

**文件：** `src/types/types.d.ts`

```typescript
interface MacroCommandInterface {
  name: string          // 显示在命令面板里的名字
  commandIds: string[]  // 按顺序执行的 Obsidian 命令 ID 数组
  delay: number         // 每两步之间的等待时间（毫秒）
}
```

### 宏的执行（MacroCommand 类）

**文件：** `src/utils/macro.ts`

```typescript
class MacroCommand {
  checkCallback(checking: boolean): boolean {
    // Obsidian 的机制：checking=true 时只检查可用性（用于显示灰色）
    //                  checking=false 时真正执行
    const firstCmd = app.commands.commands[this.commandIds[0]]

    // 如果第一个命令不可用，整个宏不可用
    if (!firstCmd?.checkCallback?.(true)) return false

    if (!checking) {
      this.callAllCommands()
    }
    return true
  }

  callAllCommands(): void {
    let index = 0
    const executeNext = () => {
      if (index >= this.commandIds.length) return

      const cmdId = this.commandIds[index]
      const cmd = app.commands.commands[cmdId]

      // 每一步执行前再检查一次是否可用
      if (!cmd || !app.commands.executeCommandById(cmdId)) {
        new Notice(`Macro stopped: command "${cmdId}" not available`)
        return
      }

      index++
      // 等待 delay 毫秒后执行下一步
      setTimeout(executeNext, this.delay)
    }

    executeNext()
  }
}
```

### 宏为什么需要 delay？

很多 Obsidian 命令依赖 UI 状态（比如"在当前文件插入模板"要求当前有打开的文件）。如果命令A打开了一个文件，命令B需要等文件打开完成才能操作。`delay` 给了中间操作"落地"的时间。

### 宏的注册

**文件：** `src/main.ts` → `loadMacroCommands()`

```typescript
loadMacroCommands(): void {
  this.settings.macros.forEach((macro, index) => {
    const macroCmd = new MacroCommand(macro.name, macro.commandIds, macro.delay)
    this.addCommand({
      id: `obsidian-better-command-palette-macro-${index}`,
      name: macro.name,
      checkCallback: (checking) => macroCmd.checkCallback(checking),
    })
  })
}
```

宏命令注册后，在 Obsidian 的快捷键设置里可以为它指定热键，和普通命令完全一样。

---

## 七、文件搜索中的特殊功能

### 文件别名支持

**文件：** `src/palette-modal-adapters/file-adapter.ts`

Obsidian 支持在 frontmatter 中定义文件别名（`aliases`）。文件适配器为每个别名创建一条单独的搜索结果：

```typescript
// 为每个别名创建 Match
for (const alias of aliases) {
  extraMatches.push({
    id: `alias:${file.path}`,  // ID 格式：alias:实际路径
    text: alias,
    tags: fileTags,
  })
}
```

这样搜索别名也能找到文件，选中后打开的是原始文件。

### 直接创建新文件

在文件模式下，如果输入的文件名不存在，按 `createNewFileMod+Enter` 直接创建：

```typescript
// file-adapter.ts → onChooseSuggestion()
if (isCreatingFile || !existingFile) {
  // 解析路径
  let filePath = match.text.replace(fileSearchPrefix, '')
  if (!filePath.endsWith('.md')) filePath += '.md'
  filePath = normalizePath(filePath)

  // 如果目录不存在，先创建目录
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  if (dir && !app.vault.getAbstractFileByPath(dir)) {
    await app.vault.createFolder(dir)
  }

  // 创建文件
  const newFile = await app.vault.create(filePath, '')
  await leaf.openFile(newFile)
}
```

### 标签过滤文件（`/readme@project`）

文件模式下，`@` 后面跟标签名，只显示带该标签的文件。这通过 Worker 里的标签过滤实现（见第四节）。每个文件的 Match 对象的 `tags` 字段里存有该文件的所有标签，Worker 用它来过滤。

---

## 八、快捷键显示是如何渲染的

内置面板显示快捷键是纯文字（`Ctrl+Shift+P`），Better Command Palette 渲染成图标（`⌘⇧P`）。

**文件：** `src/utils/utils.ts` → `generateHotKeyText()`

```typescript
// 修饰键图标映射（Mac 风格）
const MAC_ICONS = {
  Mod: '⌘',      // Cmd
  Alt: '⌥',      // Option
  Shift: '⇧',
  Ctrl: '⌃',
}

// Windows 风格用文字：Ctrl, Alt, Shift

function generateHotKeyText(hotkey: Hotkey, style: HotkeyStyle): string {
  const isMac = style === 'mac' || (style === 'auto' && Platform.isMacOS)
  const icons = isMac ? MAC_ICONS : WIN_ICONS

  const mods = hotkey.modifiers.map(m => icons[m]).join('')
  const key = hotkey.key.toUpperCase()

  return `${mods}${key}`
}
```

渲染时包在 `<kbd>` 标签里：

```typescript
// command-adapter.ts → renderSuggestion()
const hotkeys = getHotkeysForCommand(command.id)
for (const hotkey of hotkeys) {
  const kbdEl = auxEl.createEl('kbd', { cls: 'suggestion-hotkey' })
  kbdEl.textContent = generateHotKeyText(hotkey, settings.hotkeyStyle)
}
```

---

## 九、访问 Obsidian 私有 API

Obsidian 的某些功能没有公开文档，Better Command Palette 通过"不安全类型声明"来访问它们。

**文件：** `src/types/types.d.ts`

```typescript
// 访问内置命令面板的置顶列表
interface UnsafeAppInterface {
  internalPlugins: {
    getPluginById(id: 'command-palette'): {
      instance: {
        options: { pinned: string[] }  // 用户置顶的命令 ID 列表
      }
    }
  }
  commands: {
    commands: Record<string, Command>  // 所有可用命令
    executeCommandById(id: string): boolean
  }
}

// 访问 SuggestModal 内部的选中项（用于 Mod+L 粘贴路径）
interface UnsafeSuggestModalInterface {
  chooser: {
    selectedItem: number   // 当前高亮项的索引
    values: Match[]
  }
}
```

> **注意：** 这些私有 API 没有文档保证，Obsidian 版本升级可能导致失效。在修改代码时需要注意这些调用是否仍然有效。访问时使用类型断言：`(this.app as unknown as UnsafeAppInterface)`。

---

## 十、核心功能对比总结

```
内置命令面板的执行路径：
  用户打开 → 输入关键词 → 模糊匹配命令列表 → 选中执行
  （每次都从同等位置开始，没有记忆）

Better Command Palette 的执行路径：
  用户打开 → 检测前缀（/、# 或无）→ 激活对应适配器
           → 从 prevItems 里取出"重要项"固定排前面
           → Web Worker 异步模糊匹配剩余项
           → 合并排序 → 过滤隐藏项 → 渲染
  （有记忆，越用越快；有结构，三种搜索无缝切换）
```

**Better 的本质：** 减少认知负担（不用记住在哪里找什么工具）+ 减少重复操作（最常用的自动排前面）+ 减少上下文切换（一个弹窗做完命令/文件/标签三件事）。
