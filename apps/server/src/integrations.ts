import type { IntegrationContext, IntegrationManifest, IntegrationStatus } from '@assemble/core';
import { slackIntegration } from '@assemble/integration-slack';
import { linearIntegration } from '@assemble/integration-linear';

// Adding an integration = new package + one entry here.
export const registry: IntegrationManifest[] = [slackIntegration, linearIntegration];

const find = (id: string): IntegrationManifest => {
  const m = registry.find(x => x.id === id);
  if (!m) throw new Error(`unknown integration: ${id}`);
  return m;
};

export interface IntegrationInfo {
  id: string; name: string; description: string; icon: string;
  connected: boolean; detail?: string;
  fields: { key: string; label: string; placeholder: string; secret: boolean; help?: string; saved: boolean }[];
}

export function listIntegrations(ctx: IntegrationContext): Promise<IntegrationInfo[]> {
  return Promise.all(registry.map(async m => {
    const s = await m.status(ctx).catch((err): IntegrationStatus => ({ connected: false, detail: (err as Error).message }));
    return {
      id: m.id, name: m.name, description: m.description, icon: m.icon,
      connected: s.connected, detail: s.detail,
      fields: m.connectFields.map(f => ({ ...f, saved: Boolean(ctx.kv.get(f.key)) })),
    };
  }));
}

export async function connectIntegration(ctx: IntegrationContext, id: string, values: Record<string, string>): Promise<IntegrationStatus> {
  const m = find(id);
  for (const f of m.connectFields) {
    const v = values[f.key]?.trim();
    if (v) ctx.kv.set(f.key, v);
  }
  await m.start(ctx); // throws if still missing fields or the service rejects them
  return m.status(ctx);
}

export async function disconnectIntegration(ctx: IntegrationContext, id: string): Promise<void> {
  const m = find(id);
  await m.stop().catch(() => {});
  for (const f of m.connectFields) ctx.kv.del(f.key);
}

/** Boot: start whatever is already configured; failures log, never crash. */
export async function startConfigured(ctx: IntegrationContext): Promise<void> {
  for (const m of registry) {
    try { await m.start(ctx); }
    catch (err) { console.warn(`${m.id}: not started — ${(err as Error).message}`); }
  }
}

export async function stopAll(): Promise<void> {
  for (const m of registry) await m.stop().catch(() => {});
}
