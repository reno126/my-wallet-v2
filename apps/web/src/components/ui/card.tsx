import { cn } from 'cn';
import * as React from 'react';

interface CardProps extends React.ComponentProps<'div'> {
  size?: 'default' | 'sm';
}

function Card({ className, size = 'default', ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
        className,
      )}
      {...props}
    />
  );
}

interface CardHeaderProps extends React.ComponentProps<'div'> {
  className?: string;
}

function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

interface CardTitleProps extends React.ComponentProps<'h2'> {
  as?: 'h1' | 'h2' | 'h3';
}

function CardTitle({ as = 'h2', className, ...props }: CardTitleProps) {
  const Heading = as;

  return (
    <Heading
      data-slot="card-title"
      className={cn(
        'font-sans text-base leading-snug font-medium group-data-[size=sm]/card:text-sm',
        className,
      )}
      {...props}
    />
  );
}

interface CardDescriptionProps extends React.ComponentProps<'p'> {
  className?: string;
}

function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

interface CardActionProps extends React.ComponentProps<'div'> {
  className?: string;
}

function CardAction({ className, ...props }: CardActionProps) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

interface CardContentProps extends React.ComponentProps<'div'> {
  className?: string;
}

function CardContent({ className, ...props }: CardContentProps) {
  return (
    <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
  );
}

interface CardFooterProps extends React.ComponentProps<'div'> {
  className?: string;
}

function CardFooter({ className, ...props }: CardFooterProps) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
