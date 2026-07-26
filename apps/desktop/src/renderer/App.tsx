import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutGrid, AudioLines, Disc, Workflow, Activity, Settings as SettingsIcon,
} from 'lucide-react';
import { app, useApp } from './store';
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
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarInset, SidebarHeader,
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
    return { state: 'off', text: !app.config?.armed ? 'off' : 'sensors off' };
  }
  return app.config.armed ? { state: 'live', text: 'listening' } : { state: 'paused', text: 'paused' };
}

function ThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return (
    <button className="cursor-pointer rounded-lg border border-transparent px-2 py-1 text-[15px] text-dim hover:border-line hover:text-ink"
      title="Switch theme" onClick={toggleTheme}>
      {dark ? '☾' : '☀'}
    </button>
  );
}

// one control: the Listening switch, status as plain text beside it
function ListeningControl() {
  useApp();
  const s = statusInfo();
  return (
    <label
      title={s.text}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-full border border-line bg-panel/60 py-1.5 pl-3 pr-2',
        'group-data-[collapsible=icon]/sidebar:justify-center group-data-[collapsible=icon]/sidebar:rounded-xl group-data-[collapsible=icon]/sidebar:p-2',
      )}
    >
      <span className={cn(
        'min-w-0 flex-1 truncate text-xs text-dim group-data-[collapsible=icon]/sidebar:hidden',
        s.state === 'live' && 'text-ok',
        s.state === 'error' && 'text-danger',
      )}>
        {s.text}
      </span>
      <Switch checked={!!app.config?.armed} onCheckedChange={v => void window.assemble.setArmed(v)} />
    </label>
  );
}

// only landing/setup show a top strip — the app shell keeps everything in the sidebar
function Topbar() {
  useApp();
  return (
    <header className="relative z-10 flex items-center gap-3 px-4 py-2">
      <LogoMark className="size-9 rounded-[10px]" />
      <div className="ml-auto"><ThemeButton /></div>
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
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 pt-1">
            <LogoMark className="size-8 shrink-0 rounded-lg" />
            {app.recording && (
              <span className="animate-[breathe_1.2s_ease-in-out_infinite] text-xs font-bold tracking-[0.08em] text-danger group-data-[collapsible=icon]/sidebar:hidden">● REC</span>
            )}
          </div>
        </SidebarHeader>
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
          <ListeningControl />
          <div className="flex items-center justify-between group-data-[collapsible=icon]/sidebar:flex-col group-data-[collapsible=icon]/sidebar:gap-1">
            <ThemeButton />
            <SidebarTrigger />
          </div>
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
      {app.mode === 'setup' && <Topbar />}
      {app.mode === 'landing' && <Landing />}
      {app.mode === 'setup' && <Setup />}
      {app.mode === 'app' && <Shell />}
      <Toast />
      <ConsentDialog />
    </div>
  );
}
