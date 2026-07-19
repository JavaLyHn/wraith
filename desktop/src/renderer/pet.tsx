import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import PetWindowApp from './components/PetWindowApp'

const el = document.getElementById('pet-root')
if (!el) throw new Error('pet-root missing')
createRoot(el).render(<StrictMode><PetWindowApp /></StrictMode>)
