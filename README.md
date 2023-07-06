# Obsidian Better Command Palette
A plugin for Obsidian that adds a command palatte that is more user friendly and more feature rich. Use `cmd+shift+p` to to open the palette.

Quick Feature List:
1. Use backspace to close the palette
2. Recent choices bubble to the top
3. Built in quick switcher by typing `/` or using the hotkey
4. Built in tag search by typing `#` or using the hotkey
5. Search files with specific tags
6. Macro commands
7. Hide less useful Commands, Files, and Tag, but quickly see them again with `cmd+i`

Coming Soon:
1. Populate the input with recent queries automatically
2. Search files via unstructured frontmatter content

## Features
### Backspace to close
When the palette has no text entered into the input and you press backspace, then the palette will close. This can be turned off in the settings.

### Recent Choices
Choices that have been recently used will bubble up to the top of the command list.

### Pinned Commands
Commands that have been pinned in the default `Command Palette` will be pinned here as well.

### File Opening
Better Command Palette allows you to open files from the same input without needing to run a command or press `cmd+o first`. Once the palette is open just type `/` (This can be changed in the settings) and you will be searching files to open. Press `enter` to open the file.

### File Creation
If after searching for files to open there are no results you may press `cmd+enter` to create a file with the same name as you have entered. You may specify directories. If the directory path does not exist it will create it.

### File Searching using Tags
Better Command Palette allows you to find and open files that contain the tags you search for.
Type `#` (configurable in the settings) to begin searching all of the tags in your vault. Press enter to use that tag to filter the file search.

### Macro Commands
Macros can be created in the settings tab for Better Command Palette. Each Macro must be give a name, delay, and at least one command. If any of these are not set the macro will not show up in the command palette.

The delay is the number of milliseconds the macro will wait between each command. This can be useful for commands that take some time to complete.

Any command can be added including other macro commands. Each command is run in sequence. At each step the macro will check if the next command can be run. Certain commands require certain conditions to be met. A an error message will be shown if a command could not be run. The macro will only be shown in the command palette if the first command can be run at that time.

Hotkeys can be assigned to the macro in the normal hotkey tab after the macro has been created.

### Hidden Items
All items that are shown in the palette (Commands, Files, and Tags) can be hidden. Click the `X` next to the item to hide it from both current and future search results. If you want to be able to selec that item again briefly you can click the `Show hidden items` message under the search input or use `cmd+I` to reveal hidden items in the palette. These will be highlighted to better distinguish them. If you decide you want to unhide an item simply make sure hidden items are being shown, search for the item, and click the plus button next to it.

## Development
### Project Setup
1. Clone the repo
2. Run `npm install`

### Development Build
Run `npm run dev`

This will create a directory named `test-vault` in your repo (automatically ignored by git). You can point obsidian to this directory and use it as a testing environment. Files are automatically watched and the dev server will restart when they are changed.

### Local Build
Run `npm run build-local`

This builds the plugin in production mode and copies the needed files to the root of the repo (automatically ignored by git). This is to allow people who wish to manually install the plugin on their machines to easily do so by copying the plugin to their plugin directory and running the command.

### Production Build
Run `npm run build`

Builds the plugin for production and puts all neccessary files into the `dist` directory. Pretty much only used by github actions for releases.

### 插件开发心得

很多api官方没有放出来, 需要我们自己寻找
可以在控制台把大对象打印出来, 找到你需要的属性或者方法进行使用