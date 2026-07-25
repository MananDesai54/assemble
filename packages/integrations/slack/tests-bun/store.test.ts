import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureSlackTables, insertMessage, recentMessages } from '../src/store';

const fresh = () => { const db = new Database(':memory:'); ensureSlackTables(db); return db; };

describe('slack store', () => {
  it('inserts and reads back newest-first', () => {
    const db = fresh();
    insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'first', userName: 'Manan' });
    insertMessage(db, { slackTs: '2.0', channel: 'C1', text: 'second' });
    const rows = recentMessages(db, 10);
    expect(rows.length).toBe(2);
    expect(rows[0].text).toBe('second');
    expect(rows[1].user_name).toBe('Manan');
  });

  it('dedupes on (channel, slack_ts)', () => {
    const db = fresh();
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x' })).not.toBe(null);
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x again' })).toBe(null);
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C2', text: 'other channel' })).not.toBe(null);
    expect(recentMessages(db, 10).length).toBe(2);
  });

  it('is idempotent on existing DBs', () => {
    const db = fresh();
    ensureSlackTables(db); // second call: CREATE IF NOT EXISTS + column checks must not throw
    insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x' });
    expect(recentMessages(db, 1)[0].text).toBe('x');
  });
});
