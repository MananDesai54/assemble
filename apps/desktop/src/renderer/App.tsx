import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutGrid, AudioLines, Disc, Workflow, Activity, Settings as SettingsIcon,
} from 'lucide-react';
import { app, useApp, emit } from './store';
import { init, toggleTheme, setPage } from './controller';
import { Landing } from './pages/Landing';
import { Setup } from './pages/Setup';
import { DeskPage } from './pages/Desk';
import { TalkPage } from './pages/Talk';
import { CallsPage } from './pages/Calls';
import { WorkPage } from './pages/Work';
import { ActivityPage } from './pages/Activity';
import { SettingsPage } from './pages/Settings';
import { Toast } from './components/Toast';
import { LogoMark } from './components/Logo';
import { ConsentDialog } from './components/ConsentDialog';
import { Switch } from './components/ui/switch';
import {
  Sidebar, SidebarProvider, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarInset,
} from './components/ui/sidebar';
import { cn } from './lib/utils';

const NAV = [
  { page: 'desk', label: 'Desk', Icon: LayoutGrid },
  { page: 'talk', label: 'Talk', Icon: AudioLines },
  { page: 'calls', label: 'Calls', Icon: Disc },
  { page: 'work', label: 'Workflows', Icon: Workflow },
  { page: 'activity', label: 'Activity', Icon: Activity },
  { page: 'settings', label: 'Settings', Icon: SettingsIcon },
];

function statusInfo(): { state: string; text: string } {
  if (app.micError) return { state: 'error', text: 'microphone unavailable' };
  if (!app.engine) {
    return {
      state: 'off',
      text: !app.config?.armed ? 'off — flip Listening to start'
        : app.mode === 'app' ? 'sensors off — click to start' : 'sensors off',
    };
  }
  return app.config.armed ? { state: 'live', text: 'listening' } : { state: 'paused', text: 'paused' };
}

function Topbar() {
  useApp();
  const s = statusInfo();
  const dark = document.documentElement.dataset.theme === 'dark';
  return (
    <header className="glass relative z-10 flex items-center gap-3 px-4 py-2">
      <LogoMark className="size-9 rounded-[10px]" />
      {app.recording && <span className="animate-[breathe_1.2s_ease-in-out_infinite] text-xs font-bold tracking-[0.08em] text-danger">● REC</span>}
      <div className="ml-auto flex items-center gap-3">
        <button className="cursor-pointer rounded-lg border border-transparent px-2 py-1 text-[15px] text-dim hover:border-line hover:text-ink"
          title="Switch theme" onClick={toggleTheme}>
          {dark ? '☾' : '☀'}
        </button>
        {/* status + listening toggle live together in one control */}
        <div className="flex items-center gap-2.5 rounded-full border border-line bg-panel/60 py-1.5 pl-3 pr-2">
          <button
            className="flex cursor-pointer items-center gap-1.5 text-xs text-dim"
            onClick={() => { if (!app.engine && app.mode === 'app' && app.config.armed) { app.consentOpen = true; emit(); } }}
          >
            <span className={cn(
              'size-2 rounded-full bg-dim',
              s.state === 'live' && 'animate-[breathe_2.4s_ease-in-out_infinite] bg-ok shadow-[0_0_8px_var(--ok)]',
              s.state === 'paused' && 'bg-acc',
              s.state === 'error' && 'bg-danger',
            )} />
            <span>{s.text}</span>
          </button>
          {app.mode === 'app' && (
            <Switch checked={!!app.config?.armed} onCheckedChange={v => void window.assemble.setArmed(v)} />
          )}
        </div>
      </div>
    </header>
  );
}

const PAGES: Record<string, () => React.JSX.Element> = {
  desk: DeskPage, talk: TalkPage, calls: CallsPage, work: WorkPage, activity: ActivityPage, settings: SettingsPage,
};

function Shell() {
  useApp();
  const Page = PAGES[app.page] ?? DeskPage;
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              {NAV.map(({ page, label, Icon }) => (
                <SidebarMenuItem key={page}>
                  <SidebarMenuButton isActive={app.page === page} tooltip={label} onClick={() => setPage(page)}>
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarTrigger className="self-start" />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <AnimatePresence mode="wait">
          <motion.div
            key={app.page}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex flex-1 flex-col gap-4.5 overflow-y-auto px-7 py-6"
          >
            <Page />
          </motion.div>
        </AnimatePresence>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function App() {
  useApp();
  useEffect(() => { void init(); }, []);
  return (
    <div className="relative z-[1] flex h-full flex-col">
      {app.mode !== 'landing' && app.mode !== 'loading' && <Topbar />}
      {app.mode === 'landing' && <Landing />}
      {app.mode === 'setup' && <Setup />}
      {app.mode === 'app' && <Shell />}
      <Toast />
      <ConsentDialog />
    </div>
  );
}
