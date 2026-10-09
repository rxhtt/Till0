import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            registerType: 'autoUpdate',
            manifest: {
                name: 'Till0 POS',
                short_name: 'Till0',
                description: 'Industrial-grade offline-first POS',
                theme_color: '#0A0A0B',
                background_color: '#0A0A0B',
                display: 'standalone',
            },
        }),
    ],
    server: {
        port: 5173,
        host: true,
    },
});
