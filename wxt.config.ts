import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    // 名称和描述走 _locales/<lang>/messages.json,Chrome 商店会按用户语言显示
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    version: '1.1.0',
    minimum_chrome_version: '116',
    permissions: ['tabs', 'storage', 'tabGroups', 'sidePanel'],
    side_panel: { default_path: 'sidepanel.html' },
    action: {
      default_title: '__MSG_extName__',
    },
    // 全局快捷键。用户可在 chrome://extensions/shortcuts 自定义
    commands: {
      'next-space': { suggested_key: { default: 'Ctrl+Shift+Right', mac: 'Command+Shift+Right' }, description: 'Next Space' },
      'previous-space': { suggested_key: { default: 'Ctrl+Shift+Left', mac: 'Command+Shift+Left' }, description: 'Previous Space' },
      _execute_action: {
        suggested_key: {
          default: 'Ctrl+Shift+S',
          mac: 'Command+Shift+S',
        },
        description: 'Open SpaceTab',
      },
    },
    homepage_url: 'https://github.com/tashuo/spacetab',
  },
})
