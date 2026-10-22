import { build } from 'vite';

// CI keeps NODE_ENV=test for database checks; the browser artifact needs production dependencies.
process.env.NODE_ENV = 'production';
await build();
