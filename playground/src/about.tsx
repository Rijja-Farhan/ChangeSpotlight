import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Header } from './components/Header'
import { Team } from './components/Team'

// A second page, so changes seen on several pages can be tried out (Header is on both).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Header title="About the playground" />
    <Team />
  </StrictMode>,
)
