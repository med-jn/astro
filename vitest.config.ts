import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // مفاتيح وهمية: createClient لا يتصل عند الإنشاء، لكنه يرفض الإنشاء بلا عنوان
    env: { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'test-key' },
  },
});
