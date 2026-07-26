// The 2×2 desk map. Ripples on every detected transient, lights the corner
// the classifier picked — both transient bus signals handled through refs.
import { useEffect, useRef, type ReactNode } from 'react';
import { ZONES } from '@assemble/core';
import { bus } from '../store';
import { cn } from '../lib/utils';

export function DeskGrid({ corner, teachZone, onCornerClick, children }: {
  corner: (zone: (typeof ZONES)[number]) => ReactNode;
  teachZone?: string | null;
  onCornerClick?: (zoneId: string) => void;
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onRipple = () => {
      const dot = rootRef.current?.querySelector('.mic-ripple') as HTMLElement | null;
      if (!dot) return;
      dot.style.animation = 'none';
      void dot.offsetWidth; // restart animation
      dot.style.animation = 'desk-ripple 500ms ease-out';
    };
    const onLit = (e: Event) => {
      const zone = (e as CustomEvent<string>).detail;
      const el = rootRef.current?.querySelector(`[data-zone="${zone}"]`) as HTMLElement | null;
      if (!el) return;
      el.dataset.lit = 'true';
      setTimeout(() => { delete el.dataset.lit; }, 450);
    };
    bus.addEventListener('ripple', onRipple);
    bus.addEventListener('lit', onLit);
    return () => { bus.removeEventListener('ripple', onRipple); bus.removeEventListener('lit', onLit); };
  }, []);

  return (
    <div
      ref={rootRef}
      className="glass relative grid aspect-[2/1.15] w-full max-w-[720px] grid-cols-2 grid-rows-2 gap-3 rounded-[20px] border border-line p-3.5 shadow-[0_10px_30px_var(--shadow)]"
    >
      {ZONES.map(z => (
        <div
          key={z.id}
          data-zone={z.id}
          tabIndex={onCornerClick ? 0 : undefined}
          role={onCornerClick ? 'button' : undefined}
          onClick={onCornerClick ? () => onCornerClick(z.id) : undefined}
          onKeyDown={onCornerClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCornerClick(z.id); } } : undefined}
          className={cn(
            'relative flex flex-col gap-1 rounded-[14px] border border-line bg-bg/70 px-3.5 py-3 text-left transition-all',
            onCornerClick && 'cursor-pointer hover:-translate-y-px hover:border-acc',
            'data-[lit=true]:border-acc data-[lit=true]:shadow-[0_0_0_3px_var(--acc-soft),0_0_22px_var(--glow)]',
            teachZone === z.id && 'animate-[teach-pulse_1.4s_ease-in-out_infinite] border-acc',
          )}
        >
          <span className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-dim">{z.label}</span>
          {corner(z)}
        </div>
      ))}
      <div className="absolute left-1/2 top-1/2 z-[2] size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-panel bg-ink" title="your microphone">
        <span className="mic-ripple pointer-events-none absolute -inset-1 rounded-full border-2 border-acc-2 opacity-0" />
      </div>
      {children}
    </div>
  );
}
