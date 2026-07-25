import { describe, it, expect } from 'vitest';
import { startSlack } from '../src/intake';

// Wrong token types must throw before any network call — a non-xapp app
// token otherwise hangs socket.start() forever.
describe('startSlack token validation', () => {
  it('rejects a non-xapp app token', async () => {
    await expect(startSlack({ appToken: 'xoxp-user-token', botToken: 'xoxb-1', onMessage: () => {} }))
      .rejects.toThrow('xapp-');
  });

  it('rejects a non-xoxb bot token', async () => {
    await expect(startSlack({ appToken: 'xapp-1', botToken: 'xoxp-1', onMessage: () => {} }))
      .rejects.toThrow('xoxb-');
  });
});
