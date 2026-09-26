"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { getSignUpSchema, PASSWORD_HINT, type SignUpSchema } from "./schema";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FormProvider from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { RHFTextField } from "~/components/hook-form";
import { toast } from "sonner";
import { getDefaults } from "@packages/lib";
import { ContinueWith } from "~/components/continue-with";
import { DASHBOARD } from "~/app/signin/callback-path";
import type { SignInProvider } from "~/lib/sign-in-providers";
import { AuthDivider } from "~/components/auth-card";
import { signIn } from "next-auth/react";

export default function SignUpForm({
  providers,
}: {
  providers: readonly SignInProvider[];
}) {
  const schema = getSignUpSchema();
  const methods = useForm({
    resolver: standardSchemaResolver(schema),
    defaultValues: getDefaults(schema),
    mode: "onBlur",
  });
  const { handleSubmit } = methods;

  const { mutateAsync: signUp } = api.auth.signUp.useMutation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const onSubmit: SubmitHandler<SignUpSchema> = async (data) => {
    setSubmitError(null);
    setIsPending(true);
    try {
      await signUp(data);
    } catch {
      // The server won't say why, so an existing account isn't revealed.
      setSubmitError(
        "We couldn’t create an account with that email. If you already have one, sign in instead.",
      );
      setIsPending(false);
      return;
    }
    const res = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });
    if (res?.error) {
      toast.success("Your account is ready. Sign in to continue.");
      router.push("/signin");
      return;
    }
    toast.success(`Welcome to Lexidraw, ${data.name}.`);
    router.push(DASHBOARD);
  };

  return (
    <div className="flex flex-col gap-6">
      <ContinueWith providers={providers} callbackPath={DASHBOARD} />
      <AuthDivider />
      <FormProvider methods={methods} onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-4">
          <RHFTextField name="name" label="Name" autoComplete="name" />
          <RHFTextField
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
          />
          <RHFTextField
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            helperText={PASSWORD_HINT}
          />
        </div>
        <Button
          disabled={isPending}
          type="submit"
          className="mt-6 w-full"
          pending={isPending}
        >
          Create account
        </Button>
        {submitError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {submitError}
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          By creating an account you agree to the{" "}
          <Link
            className="underline underline-offset-4"
            href="/terms-of-service"
          >
            Terms
          </Link>{" "}
          and{" "}
          <Link className="underline underline-offset-4" href="/privacy-policy">
            Privacy Policy
          </Link>
          .
        </p>
      </FormProvider>
    </div>
  );
}
