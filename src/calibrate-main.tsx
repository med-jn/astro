import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import CalibrateApp from './CalibrateApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CalibrateApp />
  </StrictMode>,
)