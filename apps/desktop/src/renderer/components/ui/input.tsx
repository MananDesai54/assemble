import * as React from 'react';
import { cn } from '../../lib/utils';

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-line bg-bg/70 px-3 py-2 text-sm text-ink placeholder:text-dim outline-none transition-colors',
        'focus:border-acc/55 focus:ring-2 focus:ring-acc-soft',
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full resize-y rounded-lg border border-line bg-bg/70 px-3 py-2 text-sm text-ink placeholder:text-dim outline-none transition-colors',
        'focus:border-acc/55 focus:ring-2 focus:ring-acc-soft',
        className,
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
