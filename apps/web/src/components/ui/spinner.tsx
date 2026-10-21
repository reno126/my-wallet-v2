import { cn } from 'cn';
import { Loader2Icon } from 'lucide-react';
import type { ComponentProps } from 'react';

interface SpinnerProps extends ComponentProps<'svg'> {
  className?: string;
}

export function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
