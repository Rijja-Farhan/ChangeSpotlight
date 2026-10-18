import react from '@vitejs/plugin-react-swc'
import changeSpotlight from '@change-spotlight/vite-plugin'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [changeSpotlight(), react()],
})
