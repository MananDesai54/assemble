// Mic level bars. Level events arrive ~30/s over the bus — bars are toggled
// through refs so the meter never re-renders React.
import { useEffect, useRef } from 'react';
import { bus } from '../store';

export function Meter() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onLevel = (e: Event) => {
      const rms = (e as CustomEvent<number>).detail;
      const bars = ref.current?.children;
      if (!bars) return;
      const lit = Math.min(bars.length, Math.round(Math.pow(rms * 18, 0.5) * bars.length));
      for (let i = 0; i < bars.length; i++) {
        const el = bars[i] as HTMLElement;
        el.style.background = i < lit ? (i >= 12 ? 'var(--danger)' : 'var(--acc)') : 'var(--panel-2)';
      }
    };
    bus.addEventListener('level', onLevel);
    return () => bus.removeEventListener('level', onLevel);
  }, []);
  return (
    <div ref={ref} className="flex h-[18px] items-end justify-center gap-[3px]">
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} className="h-full w-[7px] rounded-[2px] bg-panel-2 transition-colors duration-75" />
      ))}
    </div>
  );
}
