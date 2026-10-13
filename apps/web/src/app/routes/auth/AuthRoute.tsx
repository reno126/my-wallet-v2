import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useTransition } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import type { ActionFunctionArgs } from 'react-router';
import { Link, redirect, useFetcher } from 'react-router';
import { z as zod } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

const authErrorMessages = {
  invalidInput: 'Check the information in the form and try again.',
  rateLimited: 'Too many attempts. Please wait before trying again.',
  signInFailed: 'We could not sign you in. Check your details and try again.',
  registrationFailed: 'We could not create your account. Check your details and try again.',
} as const;

const googleSignInErrorMessage = 'Google sign-in is unavailable. Try again later.';

type AuthActionError = keyof typeof authErrorMessages;

interface AuthActionData {
  error: AuthActionError;
}

function createAuthFormSchema(isRegistration: boolean) {
  return zod
    .object({
      name: zod.string().trim().max(100),
      email: zod.email(),
      password: zod.string().min(8).max(128),
    })
    .superRefine(({ name }, context) => {
      if (isRegistration && name.length === 0) {
        context.addIssue({ code: 'custom', path: ['name'], message: 'Enter your name.' });
      }
    });
}

type AuthFormValues = zod.infer<ReturnType<typeof createAuthFormSchema>>;

export function SignInRoute() {
  return <AuthRoute isRegistration={false} />;
}

export function RegisterRoute() {
  return <AuthRoute isRegistration />;
}

export function signInAction({ request }: ActionFunctionArgs) {
  return submitCredentials(request, false);
}

export function registerAction({ request }: ActionFunctionArgs) {
  return submitCredentials(request, true);
}

async function submitCredentials(request: Request, isRegistration: boolean) {
  const rawValues = Object.fromEntries(await request.formData());
  const parsedValues = createAuthFormSchema(isRegistration).safeParse(rawValues);

  if (!parsedValues.success) {
    return { error: 'invalidInput' } satisfies AuthActionData;
  }

  const { name, email, password } = parsedValues.data;

  try {
    const result = isRegistration
      ? await authClient.signUp.email({ name, email, password, callbackURL: '/wallets' })
      : await authClient.signIn.email({ email, password, callbackURL: '/wallets' });

    if (result.error) {
      return {
        error:
          result.error.status === 429
            ? 'rateLimited'
            : isRegistration
              ? 'registrationFailed'
              : 'signInFailed',
      } satisfies AuthActionData;
    }

    return redirect('/wallets');
  } catch {
    return {
      error: isRegistration ? 'registrationFailed' : 'signInFailed',
    } satisfies AuthActionData;
  }
}

interface AuthRouteProps {
  isRegistration: boolean;
}

function AuthRoute({ isRegistration }: AuthRouteProps) {
  const fetcher = useFetcher<AuthActionData>();
  const [isSocialPending, startSocialTransition] = useTransition();
  const formSchema = useMemo(() => createAuthFormSchema(isRegistration), [isRegistration]);
  const authForm = useForm<AuthFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const setFormError = authForm.setError;
  const isPending = fetcher.state !== 'idle' || isSocialPending;

  useEffect(() => {
    if (fetcher.data?.error) {
      setFormError('root', {
        type: 'server',
        message: authErrorMessages[fetcher.data.error],
      });
    }
  }, [fetcher.data, setFormError]);

  function submitForm(values: AuthFormValues) {
    authForm.clearErrors('root');
    void fetcher.submit(values, { method: 'post' });
  }

  function signInWithGoogle() {
    authForm.clearErrors('root');
    startSocialTransition(async () => {
      try {
        const result = await authClient.signIn.social({
          provider: 'google',
          callbackURL: '/wallets',
        });

        if (result.error) {
          authForm.setError('root', { type: 'server', message: googleSignInErrorMessage });
        }
      } catch {
        authForm.setError('root', { type: 'server', message: googleSignInErrorMessage });
      }
    });
  }

  const alternatePath = isRegistration ? '/login' : '/register';
  const alternateLabel = isRegistration ? 'Sign in' : 'Create an account';
  const rootErrorMessage = authForm.formState.errors.root?.message;

  return (
    <section aria-labelledby="auth-title" className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">My Wallet</p>
          <CardTitle as="h1" className="text-3xl font-semibold tracking-tight" id="auth-title">
            {isRegistration ? 'Create your account' : 'Welcome back'}
          </CardTitle>
          <CardDescription>
            {isRegistration
              ? 'Sign up to keep your investment tracking in one place.'
              : 'Sign in to continue to your wallets.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            noValidate
            onSubmit={(event) => {
              void authForm.handleSubmit(submitForm)(event);
            }}
          >
            <AuthCredentialFields form={authForm} isRegistration={isRegistration} />
            {rootErrorMessage ? (
              <Alert variant="destructive">
                <AlertDescription>{rootErrorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <Button disabled={isPending} type="submit">
              {fetcher.state !== 'idle'
                ? 'Please wait…'
                : isRegistration
                  ? 'Create account'
                  : 'Sign in'}
            </Button>
            <div
              aria-hidden="true"
              className="flex items-center gap-3 text-xs text-muted-foreground"
            >
              <span className="h-px flex-1 bg-border" />
              <span>or continue with</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button disabled={isPending} onClick={signInWithGoogle} type="button" variant="outline">
              {isSocialPending ? 'Connecting…' : 'Continue with Google'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center gap-1 text-sm text-muted-foreground">
          <span>{isRegistration ? 'Already have an account?' : 'New to My Wallet?'}</span>
          <Button asChild variant="link">
            <Link to={alternatePath}>{alternateLabel}</Link>
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}

interface AuthCredentialFieldsProps {
  form: UseFormReturn<AuthFormValues>;
  isRegistration: boolean;
}

function AuthCredentialFields({ form, isRegistration }: AuthCredentialFieldsProps) {
  const nameError = form.formState.errors.name?.message;
  const emailError = form.formState.errors.email?.message;
  const passwordError = form.formState.errors.password?.message;

  return (
    <FieldGroup>
      {isRegistration ? (
        <Field data-invalid={Boolean(nameError)}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            autoComplete="name"
            aria-describedby={nameError ? 'name-error' : undefined}
            aria-invalid={Boolean(nameError)}
            id="name"
            maxLength={100}
            required
            {...form.register('name')}
          />
          <FieldError id={nameError ? 'name-error' : undefined}>{nameError}</FieldError>
        </Field>
      ) : null}
      <Field data-invalid={Boolean(emailError)}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input
          autoComplete="email"
          aria-describedby={emailError ? 'email-error' : undefined}
          aria-invalid={Boolean(emailError)}
          id="email"
          required
          type="email"
          {...form.register('email')}
        />
        <FieldError id={emailError ? 'email-error' : undefined}>{emailError}</FieldError>
      </Field>
      <Field data-invalid={Boolean(passwordError)}>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input
          autoComplete={isRegistration ? 'new-password' : 'current-password'}
          aria-describedby={passwordError ? 'password-error' : undefined}
          aria-invalid={Boolean(passwordError)}
          id="password"
          maxLength={128}
          minLength={8}
          required
          type="password"
          {...form.register('password')}
        />
        <FieldError id={passwordError ? 'password-error' : undefined}>{passwordError}</FieldError>
      </Field>
    </FieldGroup>
  );
}
