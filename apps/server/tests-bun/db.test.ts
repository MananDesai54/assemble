import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, kvGet, kvSet, kvDel } from '../src/db';

const fresh = () => openDb(join(mkdtempSync(join(tmpdir(), 'assemble-db-')), 'test.db'));

describe('db', () => {
  it('kv roundtrip', () => {
    const db = fresh();
    expect(kvGet(db, 'cursor')).toBe(null);
    kvSet(db, 'cursor', 'abc');
    kvSet(db, 'cursor', 'def');
    expect(kvGet(db, 'cursor')).toBe('def');
  });

  it('kv delete', () => {
    const db = fresh();
    kvSet(db, 'gone', 'x');
    kvDel(db, 'gone');
    expect(kvGet(db, 'gone')).toBe(null);
    kvDel(db, 'never-existed'); // no throw
  });
});
