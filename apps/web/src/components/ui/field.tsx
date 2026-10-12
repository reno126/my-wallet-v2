import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

interface FieldSetProps extends React.ComponentProps<'fieldset'> {
  className?: string;
}

function FieldSet({ className, ...props }: FieldSetProps) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
        className,
      )}
      {...props}
    />
  );
}

interface FieldLegendProps extends React.ComponentProps<'legend'> {
  className?: string;
  variant?: 'legend' | 'label';
}

function FieldLegend({ className, variant = 'legend', ...props }: FieldLegendProps) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        'mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base',
        className,
      )}
      {...props}
    />
  );
}

interface FieldGroupProps extends React.ComponentProps<'div'> {
  className?: string;
}

function FieldGroup({ className, ...props }: FieldGroupProps) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
        className,
      )}
      {...props}
    />
  );
}

const fieldVariants = cva('group/field flex w-full gap-2 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
      horizontal:
        'flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      responsive:
        'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

interface FieldProps extends React.ComponentProps<'div'>, VariantProps<typeof fieldVariants> {
  className?: string;
}

function Field({ className, orientation = 'vertical', ...props }: FieldProps) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

interface FieldContentProps extends React.ComponentProps<'div'> {
  className?: string;
}

function FieldContent({ className, ...props }: FieldContentProps) {
  return (
    <div
      data-slot="field-content"
      className={cn('group/field-content flex flex-1 flex-col gap-0.5 leading-snug', className)}
      {...props}
    />
  );
}

interface FieldLabelProps extends React.ComponentProps<typeof Label> {
  className?: string;
}

function FieldLabel({ className, ...props }: FieldLabelProps) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-[state=checked]:border-primary/30 has-data-[state=checked]:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50 has-[>[data-slot=field]]:has-[:focus-visible]:border-ring has-[>[data-slot=field]]:has-[:focus-visible]:ring-3 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring/50 *:data-[slot=field]:p-2.5',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

interface FieldTitleProps extends React.ComponentProps<'div'> {
  className?: string;
}

function FieldTitle({ className, ...props }: FieldTitleProps) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        'flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

interface FieldDescriptionProps extends React.ComponentProps<'p'> {
  className?: string;
}

function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        'text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-[orientation=horizontal]/field:text-balance [[data-variant=legend]+&]:-mt-1.5',
        'last:mt-0 nth-last-2:-mt-1',
        '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  );
}

interface FieldSeparatorProps extends React.ComponentProps<'div'> {
  children?: React.ReactNode;
  className?: string;
}

function FieldSeparator({ children, className, ...props }: FieldSeparatorProps) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
        className,
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  );
}

interface FieldErrorProps extends React.ComponentProps<'div'> {
  children?: React.ReactNode;
  className?: string;
  errors?: Array<{ message?: string } | undefined>;
}

function FieldError({ className, children, errors, ...props }: FieldErrorProps) {
  const errorMessages = [
    ...new Set(
      errors
        ?.map((error) => error?.message)
        .filter((message): message is string => typeof message === 'string'),
    ),
  ];
  const content =
    children ||
    (errorMessages.length === 1 ? (
      errorMessages[0]
    ) : errorMessages.length > 1 ? (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {errorMessages.map((errorMessage) => (
          <li key={errorMessage}>{errorMessage}</li>
        ))}
      </ul>
    ) : null);

  if (!content) {
    return null;
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn('text-sm font-normal text-destructive', className)}
      {...props}
    >
      {content}
    </div>
  );
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
};
