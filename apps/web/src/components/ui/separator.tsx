import { cn } from 'cn';
import { Separator as SeparatorPrimitive } from 'radix-ui';
import * as React from 'react';

interface SeparatorProps extends React.ComponentProps<typeof SeparatorPrimitive.Root> {
  className?: string;
}

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
