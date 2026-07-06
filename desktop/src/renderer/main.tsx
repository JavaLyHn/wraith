import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import App from './App'
import { SettingsProvider } from './settings/SettingsContext'
import { loadPrefs } from './settings/prefs'
import { applyTheme, prefersDark } from './settings/theme'

// FOUC 防闪:渲染前按已存偏好先上主题
applyTheme(loadPrefs().ui, prefersDark())

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>
)
