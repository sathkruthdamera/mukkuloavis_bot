import * as mock from './avis-mock.js';
import * as avis from './avis-playwright.js';

const PROVIDERS = { mock, avis };

export function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown provider "${name}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  return p;
}
