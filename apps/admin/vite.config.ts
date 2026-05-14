import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5174,
        strictPort: true,
        // Uncomment to proxy /api calls to the backend during local dev:
        // proxy: { '/api': 'http://localhost:3010' },
    },
    preview: {
        port: 5174,
        strictPort: true,
    },
    test: {
        environment: 'jsdom',
        globals: true,
    },
});
