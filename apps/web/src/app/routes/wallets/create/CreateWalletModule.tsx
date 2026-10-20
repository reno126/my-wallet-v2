import { zodResolver } from '@hookform/resolvers/zod';
import { SubmitEventHandler, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { ActionFunctionArgs } from 'react-router';
import { redirect, useActionData, useNavigate, useNavigation, useSubmit } from 'react-router';
import { toast } from 'sonner';
import type { z as zod } from 'zod';

import { createWalletSchema } from '@my-wallets/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createRequestClient } from '@/lib/api/createRequestClient';
import { createWalletApi } from '@/lib/api/wallets';

import { walletFailureMessage } from '../_utils/walletFailureMessage';
import { walletDictionary as walletMsg } from '../walletDictionary';

const walletActionSchema = createWalletSchema.pick({ name: true, description: true });
const walletFormSchema = walletActionSchema.required({ description: true });
type WalletFormValues = zod.infer<typeof walletFormSchema>;

export async function createWalletAction({ request }: ActionFunctionArgs) {
  let rawValues: unknown;
  try {
    rawValues = await request.json();
  } catch {
    request.signal.throwIfAborted();
    return { error: walletMsg.create.invalid };
  }
  const parsed = walletActionSchema.safeParse(rawValues);
  if (!parsed.success) {
    return { error: walletMsg.create.invalid };
  }

  const client = createRequestClient(request.signal);
  const wallets = createWalletApi(client);
  const result = await wallets.create({ ...parsed.data, reportingCurrency: 'USD' });
  if (!result.ok) {
    return {
      error: walletFailureMessage(result.error, {
        failed: walletMsg.create.failed,
        unconfirmed: walletMsg.create.unconfirmed,
      }),
    };
  }
  toast.success(walletMsg.create.confirmed);
  return redirect(`/wallets/${result.value.id}`);
}

export function CreateWalletComponent() {
  const actionData = useActionData<typeof createWalletAction>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const form = useForm<WalletFormValues>({
    resolver: zodResolver(walletFormSchema),
    defaultValues: { name: '', description: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const isPending = isSubmitting || navigation.state !== 'idle';
  const { setError } = form;
  useEffect(() => {
    if (actionData?.error) {
      setError('root', { type: 'server', message: actionData.error });
    }
  }, [actionData, setError]);

  async function submitWallet(values: WalletFormValues) {
    form.clearErrors('root');
    await submit(values, { method: 'post', encType: 'application/json' });
  }

  const handleSubmitWallet: SubmitEventHandler<HTMLFormElement> = (event) => {
    if (isPending) {
      event.preventDefault();
      return;
    }
    void form.handleSubmit(submitWallet)(event);
  };

  return (
    <section
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
      aria-labelledby="wallet-create-title"
    >
      <Card>
        <CardHeader>
          <CardTitle as="h1" id="wallet-create-title">
            {walletMsg.create.title}
          </CardTitle>
          <CardDescription>{walletMsg.create.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-6" noValidate onSubmit={handleSubmitWallet}>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.name)} data-disabled={isPending}>
                <FieldLabel htmlFor="wallet-name">{walletMsg.create.name}</FieldLabel>
                <Input
                  id="wallet-name"
                  autoComplete="off"
                  maxLength={100}
                  required
                  disabled={isPending}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'wallet-name-error' : undefined}
                  placeholder={walletMsg.create.namePlaceholder}
                  {...form.register('name')}
                />
                <FieldError id="wallet-name-error">{errors.name?.message}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.description)} data-disabled={isPending}>
                <FieldLabel htmlFor="wallet-description">
                  {walletMsg.create.descriptionLabel}
                </FieldLabel>
                <Textarea
                  id="wallet-description"
                  maxLength={500}
                  disabled={isPending}
                  aria-invalid={Boolean(errors.description)}
                  aria-describedby={errors.description ? 'wallet-description-error' : undefined}
                  placeholder={walletMsg.create.descriptionPlaceholder}
                  {...form.register('description')}
                />
                <FieldError id="wallet-description-error">{errors.description?.message}</FieldError>
              </Field>
              <Field>
                <FieldTitle>{walletMsg.create.currencyLabel}</FieldTitle>
                <Badge variant="secondary">USD</Badge>
                <p className="text-sm text-muted-foreground">{walletMsg.create.currencyNote}</p>
              </Field>
              {!isPending && errors.root?.message ? (
                <Alert variant="destructive">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={isPending}
                type="button"
                variant="outline"
                onClick={() => void navigate('/wallets')}
              >
                {walletMsg.create.cancel}
              </Button>
              <Button disabled={isPending} type="submit">
                {isPending ? walletMsg.create.submitting : walletMsg.create.submit}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
