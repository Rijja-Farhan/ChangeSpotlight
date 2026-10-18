import react from '@vitejs/plugin-react'
import reactSwc from '@vitejs/plugin-react-swc'
import changeSpotlight from '@change-spotlight/vite-plugin'
import { defineConfig } from 'vite'

// CS_REACT=react uses @vitejs/plugin-react (Oxc); the default uses @vitejs/plugin-react-swc.
// Change Spotlight must work with both, since it never depends on the JSX compiler.
const reactPlugin = process.env.CS_REACT === 'react' ? react() : reactSwc()

// https://vite.dev/config/
export default defineConfig({
  plugins: [changeSpotlight(), reactPlugin],
})
