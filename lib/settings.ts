import { useEffect, useState } from 'react'

const KEY_NEWTAB = 'useAsNewtab'

/** 是否让 SpaceTab 接管新标签页(Cmd+T)。默认关闭。 */
export async function readUseAsNewtab(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get(KEY_NEWTAB)
    return r[KEY_NEWTAB] === true
  } catch {
    return false
  }
}

export async function writeUseAsNewtab(v: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY_NEWTAB]: v })
  } catch {
    // 忽略写入失败,UI 状态层会以读到的值为准
  }
}

export function useUseAsNewtab(): {
  enabled: boolean
  setEnabled: (v: boolean) => void
} {
  const [enabled, setState] = useState(false)
  useEffect(() => {
    let mounted = true
    void readUseAsNewtab().then((v) => {
      if (mounted) setState(v)
    })
    const onChange = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'local' && KEY_NEWTAB in changes) {
        setState(changes[KEY_NEWTAB]?.newValue === true)
      }
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(onChange)
    }
  }, [])
  const setEnabled = (v: boolean) => {
    setState(v)
    void writeUseAsNewtab(v)
  }
  return { enabled, setEnabled }
}

const KEY_GROUP_BY_DOMAIN = 'groupTabsByDomain'

/** 是否在空间卡片内按域名分组渲染 tab。默认开启。 */
export async function readGroupTabsByDomain(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get(KEY_GROUP_BY_DOMAIN)
    // 未设置过 → 默认开启;显式 false 时关闭
    return r[KEY_GROUP_BY_DOMAIN] !== false
  } catch {
    return true
  }
}

export async function writeGroupTabsByDomain(v: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY_GROUP_BY_DOMAIN]: v })
  } catch {
    // 同 useAsNewtab:写失败由读端兜底
  }
}

export function useGroupTabsByDomain(): {
  enabled: boolean
  setEnabled: (v: boolean) => void
} {
  // 同步初始 = true,避免首帧从 false 闪到 true
  const [enabled, setState] = useState(true)
  useEffect(() => {
    let mounted = true
    void readGroupTabsByDomain().then((v) => {
      if (mounted) setState(v)
    })
    const onChange = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'local' && KEY_GROUP_BY_DOMAIN in changes) {
        setState(changes[KEY_GROUP_BY_DOMAIN]?.newValue !== false)
      }
    }
    try {
      chrome.storage.onChanged.addListener(onChange)
    } catch {
      // dev / 非扩展环境忽略
    }
    return () => {
      mounted = false
      try {
        chrome.storage.onChanged.removeListener(onChange)
      } catch {
        // 同上
      }
    }
  }, [])
  const setEnabled = (v: boolean) => {
    setState(v)
    void writeGroupTabsByDomain(v)
  }
  return { enabled, setEnabled }
}
