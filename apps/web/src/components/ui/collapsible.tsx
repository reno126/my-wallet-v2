import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

interface CollapsibleProps extends ComponentProps<typeof CollapsiblePrimitive.Root> {
  className?: string;
}

export function Collapsible(props: CollapsibleProps) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

interface CollapsibleTriggerProps extends ComponentProps<typeof CollapsiblePrimitive.Trigger> {
  className?: string;
}

export function CollapsibleTrigger(props: CollapsibleTriggerProps) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

interface CollapsibleContentProps extends ComponentProps<typeof CollapsiblePrimitive.Content> {
  className?: string;
}

export function CollapsibleContent(props: CollapsibleContentProps) {
  return <CollapsiblePrimitive.Content data-slot="collapsible-content" {...props} />;
}
