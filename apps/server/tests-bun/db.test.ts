import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, insertMessage, recentMessages, kvGet, kvSet } from '../src/db';

const fresh = () => openDb(join(mkdtempSync(join(tmpdir(), 'assemble-db-')), 'test.db'));

describe('db', () => {
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
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x' })).toBe(true);
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C1', text: 'x again' })).toBe(false);
    expect(insertMessage(db, { slackTs: '1.0', channel: 'C2', text: 'other channel' })).toBe(true);
    expect(recentMessages(db, 10).length).toBe(2);
  });

  it('kv roundtrip', () => {
    const db = fresh();
    expect(kvGet(db, 'cursor')).toBe(null);
    kvSet(db, 'cursor', 'abc');
    kvSet(db, 'cursor', 'def');
    expect(kvGet(db, 'cursor')).toBe('def');
  });
});
