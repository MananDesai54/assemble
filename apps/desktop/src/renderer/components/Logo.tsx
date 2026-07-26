// Monochrome A-mark — the brand logo redrawn in metallic silver/graphite,
// matching the gray/black theme (no multi-color gradients).
import { useId } from 'react';
import { cn } from '../lib/utils';

export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 400 400" role="img" aria-label="assemble logo" className={cn('block', className)}>
      <defs>
        <linearGradient id={`${id}-m`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f5f5f7" />
          <stop offset="100%" stopColor="#8e8e96" />
        </linearGradient>
      </defs>
      <rect width="400" height="400" rx="40" fill="#111114" />
      <g transform="translate(100, 100)">
        <path d="M 30 190 L 80 80 L 110 80 L 60 190 Z" fill={`url(#${id}-m)`} />
        <path d="M 170 190 L 120 80 L 90 80 L 140 190 Z" fill={`url(#${id}-m)`} opacity="0.65" />
        <path d="M 100 30 L 135 90 L 65 90 Z" fill="#f5f5f7" />
        <polygon points="65,130 135,130 150,155 50,155" fill={`url(#${id}-m)`} opacity="0.85" />
      </g>
    </svg>
  );
}
