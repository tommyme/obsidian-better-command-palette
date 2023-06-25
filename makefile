build:
	pnpm build
beta: build
	gsed -i "s/obsidian-better-command-palette/obsidian-better-command-palette-beta/g" dist/manifest.json
	gsed -i 's/Better Command Palette/Better Command Palette Beta/g' dist/manifest.json
install: beta
	cp -r dist "/Users/flag/repos/test-vault/.obsidian/plugins/obsidian-better-command-palette-beta"
