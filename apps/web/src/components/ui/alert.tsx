import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import * as React from 'react';

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface AlertProps extends React.ComponentProps<'div'>, VariantProps<typeof alertVariants> {
  className?: string;
}

function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

interface AlertTitleProps extends React.ComponentProps<'h2'> {
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}

function AlertTitle({ as = 'h2', className, ...props }: AlertTitleProps) {
  const Heading = as;

  return (
    <Heading
      data-slot="alert-title"
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

interface AlertDescriptionProps extends React.ComponentProps<'div'> {
  className?: string;
}

function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className,
      )}
      {...props}
    />
  );
}

interface AlertActionProps extends React.ComponentProps<'div'> {
  className?: string;
}

function AlertAction({ className, ...props }: AlertActionProps) {
  return (
    <div data-slot="alert-action" className={cn('absolute top-2 right-2', className)} {...props} />
  );
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
