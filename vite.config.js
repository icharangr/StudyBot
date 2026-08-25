import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    {
      name: 'studybot-runtime-guard',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/src/main.jsx') && !code.includes("from 'react-dom/client'")) {
          return {
            code: `import { createRoot } from 'react-dom/client';\n${code}`,
            map: null,
          };
        }
      },
    },
    react(),
  ],
});
