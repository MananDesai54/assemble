import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        default: 'bg-grad text-white font-semibold hover:-translate-y-px hover:shadow-glow',
        secondary: 'glass border border-line hover:bg-panel-2 hover:border-acc/40',
        ghost: 'border border-transparent text-dim hover:border-line hover:text-ink',
        danger: 'glass border border-danger text-danger hover:bg-danger/10',
        link: 'text-dim underline underline-offset-2 hover:text-ink text-[13px]',
      },
      size: {
        default: 'px-4.5 py-2',
        lg: 'px-10 py-3.5 text-[17px]',
        sm: 'px-3 py-1.5 text-[13px]',
        icon: 'size-8 rounded-lg',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({ className, variant, size, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
