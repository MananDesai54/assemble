// shadcn/ui sidebar, trimmed for a desktop-only Electron app:
// no mobile sheet, no cookie persistence, tooltips via title attributes.
import * as React from 'react';
import { PanelLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

type SidebarContextValue = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

export function SidebarProvider({ defaultOpen = true, className, children, ...props }:
  React.ComponentProps<'div'> & { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const toggleSidebar = React.useCallback(() => setOpen(o => !o), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  const value = React.useMemo<SidebarContextValue>(
    () => ({ state: open ? 'expanded' : 'collapsed', open, setOpen, toggleSidebar }),
    [open, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        style={{ '--sidebar-width': '13rem', '--sidebar-width-icon': '3.25rem' } as React.CSSProperties}
        className={cn('flex min-h-0 w-full flex-1', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ className, children, ...props }: React.ComponentProps<'div'>) {
  const { state } = useSidebar();
  return (
    <div
      data-state={state}
      data-collapsible={state === 'collapsed' ? 'icon' : ''}
      className={cn(
        'group/sidebar flex shrink-0 flex-col bg-transparent transition-[width] duration-200 ease-linear',
        'w-[var(--sidebar-width)] data-[collapsible=icon]:w-[var(--sidebar-width-icon)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}

export function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto', className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}

export function SidebarSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mx-2 h-px bg-line', className)} {...props} />;
}

export function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('relative flex w-full min-w-0 flex-col p-2', className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex h-8 shrink-0 items-center rounded-md px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim outline-none transition-opacity',
        'group-data-[collapsible=icon]/sidebar:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul className={cn('flex w-full min-w-0 flex-col gap-1', className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li className={cn('relative', className)} {...props} />;
}

export function SidebarMenuButton({ className, isActive = false, tooltip, ...props }:
  React.ComponentProps<'button'> & { isActive?: boolean; tooltip?: string }) {
  const { state } = useSidebar();
  return (
    <button
      data-active={isActive}
      title={state === 'collapsed' ? tooltip : undefined}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg p-2 text-left text-[13.5px] outline-none transition-colors',
        'text-dim hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-acc',
        'data-[active=true]:bg-acc-soft data-[active=true]:font-semibold data-[active=true]:text-acc',
        'group-data-[collapsible=icon]/sidebar:size-9 group-data-[collapsible=icon]/sidebar:justify-center group-data-[collapsible=icon]/sidebar:p-2',
        '[&>svg]:size-4 [&>svg]:shrink-0',
        '[&>span:last-child]:truncate group-data-[collapsible=icon]/sidebar:[&>span:last-child]:hidden',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Toggle sidebar (⌘B)"
      className={cn('text-dim', className)}
      onClick={e => { props.onClick?.(e); toggleSidebar(); }}
      {...props}
    >
      <PanelLeft className="size-4" />
    </Button>
  );
}

export function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  // Linear-style separation: content floats as an inset card over the window chrome
  return (
    <main
      className={cn(
        'mb-2 mr-2 mt-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line',
        'bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] backdrop-blur-[14px] shadow-[0_2px_16px_var(--shadow)]',
        className,
      )}
      {...props}
    />
  );
}
