import { describe, it, expect } from 'vitest';
import { myIssues } from '../src/api';

describe('myIssues', () => {
  it('queries with the api key and normalizes nodes', async () => {
    const calls: any[] = [];
    const fetchFn = (async (url: string, init: any) => {
      calls.push({ url, headers: init.headers });
      return {
        ok: true,
        json: async () => ({
          data: { viewer: { assignedIssues: { nodes: [
            { id: '1', identifier: 'ENG-42', title: 'Fix login', url: 'https://linear.app/x', description: 'desc', state: { name: 'In Progress' } },
          ] } } },
        }),
      } as Response;
    }) as typeof fetch;
    const issues = await myIssues('lin_api_123', fetchFn);
    expect(calls[0].url).toContain('api.linear.app');
    expect(calls[0].headers.Authorization).toBe('lin_api_123');
    expect(issues).toEqual([{
      id: '1', identifier: 'ENG-42', title: 'Fix login',
      state: 'In Progress', url: 'https://linear.app/x', description: 'desc',
    }]);
  });

  it('surfaces graphql errors', async () => {
    const fetchFn = (async () => ({
      ok: true, json: async () => ({ errors: [{ message: 'bad key' }] }),
    })) as unknown as typeof fetch;
    await expect(myIssues('k', fetchFn)).rejects.toThrow('bad key');
  });
});
