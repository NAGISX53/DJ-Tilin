import { config } from './config.js';
import { validateConfig } from './validate-config.js';

try {
  validateConfig(config);
  await import('./index.js');
} catch (error) {
  console.error(`[INICIO] ${error.message}`);
  process.exitCode = 1;
}
