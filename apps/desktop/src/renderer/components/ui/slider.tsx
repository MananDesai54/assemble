import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '../../lib/utils';

function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex w-60 touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-panel-2">
        <SliderPrimitive.Range className="absolute h-full bg-grad" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 cursor-pointer rounded-full border border-line bg-white shadow outline-none focus-visible:ring-2 focus-visible:ring-acc" />
    </SliderPrimitive.Root>
  );
}

export { Slider };
