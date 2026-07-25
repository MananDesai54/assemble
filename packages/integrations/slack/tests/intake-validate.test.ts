import { describe, it, expect } from 'vitest';
import { startSlack } from '../src/intake';

// Wrong token type must throw before any network call.
describe('startSlack token validation', () => {
  it('rejects a non-xoxp token', async () => {
    await expect(startSlack({ userToken: 'xoxb-bot-token', onMessage: () => {} }))
      .rejects.toThrow('xoxp-');
    await expect(startSlack({ userToken: 'xapp-app-token', onMessage: () => {} }))
      .rejects.toThrow('xoxp-');
  });
});
