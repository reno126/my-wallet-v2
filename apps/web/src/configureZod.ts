import { z as zod } from 'zod';

// Configure before schema modules load: code-generation probes violate script-src 'self'.
zod.config({ jitless: true });
