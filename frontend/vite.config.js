import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
	base: './',
	plugins: [vue(), tailwind()],
	build: {
		outDir: process.env.TEST_KIT_VIEWER_OUT ?? '../viewer',
		emptyOutDir: true,
		sourcemap: false,
		rolldownOptions: {
			output: {
				entryFileNames: 'app.js',
				chunkFileNames: 'chunks/[name]-[hash].js',
				assetFileNames: 'style[extname]',
			},
		},
	},
	test: { environment: 'jsdom', include: ['src/**/*.spec.js'] },
});
