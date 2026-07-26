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

describe('talk chats', () => {
  const freshTalk = () => {
    const db = fresh();
    // openDb doesn't create talk tables — the server does at boot
    const { ensureTalkTables } = require('../src/db');
    ensureTalkTables(db);
    return db;
  };

  it('creates chats, titles from first user message, persists turns', () => {
    const db = freshTalk();
    const { createTalkChat, addTalkMessage, talkMessages, listTalkChats } = require('../src/db');
    const chat = createTalkChat(db);
    expect(chat.title).toBe('New chat');
    addTalkMessage(db, chat.id, 'user', 'kya haal hai, assemble?');
    addTalkMessage(db, chat.id, 'assistant', 'sab badhiya!');
    expect(listTalkChats(db)[0].title).toBe('kya haal hai, assemble?');
    const msgs = talkMessages(db, chat.id);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('user');
  });

  it('summary fold point filters messages; delete removes everything', () => {
    const db = freshTalk();
    const { createTalkChat, addTalkMessage, talkMessages, setTalkSummary, getTalkChat, deleteTalkChat } = require('../src/db');
    const chat = createTalkChat(db);
    const id1 = addTalkMessage(db, chat.id, 'user', 'one');
    addTalkMessage(db, chat.id, 'assistant', 'two');
    setTalkSummary(db, chat.id, 'talked about one', id1);
    expect(getTalkChat(db, chat.id)!.summary).toBe('talked about one');
    expect(talkMessages(db, chat.id, id1).length).toBe(1);
    deleteTalkChat(db, chat.id);
    expect(getTalkChat(db, chat.id)).toBeNull();
    expect(talkMessages(db, chat.id).length).toBe(0);
  });
});
