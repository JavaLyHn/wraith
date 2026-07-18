import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { type PetPrefs, type Prefs, type ProfilePrefs, type UiPrefs, type UpdatePrefs, loadPrefs, savePrefs } from './prefs'
import { applyTheme, prefersDark } from './theme'

interface SettingsCtx {
  prefs: Prefs
  setProfile: (patch: Partial<ProfilePrefs>) => void
  setUi: (patch: Partial<UiPrefs>) => void
  setUpdate: (patch: Partial<UpdatePrefs>) => void
  setPets: (patch: Partial<PetPrefs>) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const systemDark = useRef(prefersDark())
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  // 挂载即按当前偏好上主题(与 main.tsx 早期 apply 幂等)
  useEffect(() => { applyTheme(prefsRef.current.ui, systemDark.current) }, [])

  // theme=system 时跟随系统深浅色切换
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => { systemDark.current = mq.matches; applyTheme(prefsRef.current.ui, systemDark.current) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const persist = (next: Prefs): void => { setPrefs(next); savePrefs(next); applyTheme(next.ui, systemDark.current) }
  const setProfile = (patch: Partial<ProfilePrefs>): void => persist({ ...prefsRef.current, profile: { ...prefsRef.current.profile, ...patch } })
  const setUi = (patch: Partial<UiPrefs>): void => persist({ ...prefsRef.current, ui: { ...prefsRef.current.ui, ...patch } })
  const setUpdate = (patch: Partial<UpdatePrefs>): void => persist({ ...prefsRef.current, update: { ...prefsRef.current.update, ...patch } })
  const setPets = (patch: Partial<PetPrefs>): void => persist({ ...prefsRef.current, pets: { ...prefsRef.current.pets, ...patch } })

  return <Ctx.Provider value={{ prefs, setProfile, setUi, setUpdate, setPets }}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSettings must be used within SettingsProvider')
  return c
}
