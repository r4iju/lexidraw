"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { getSignInSchema, type SignInSchema } from "./schema";
import FormProvider from "~/components/hook-form";
import { RHFTextField } from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { getDefaults } from "@packages/lib";
import { GitHubMark } from "~/components/github-mark";
import { AuthDivider } from "~/components/auth-card";

const WRONG_CREDENTIALS =
  "That email and password don’t match. Try again or use GitHub.";

export default function SignInForm() {
  const schema = getSignInSchema();
  const router = useRouter();

  const methods = useForm({
    resolver: standardSchemaResolver(schema),
    defaultValues: getDefaults(schema),
    mode: "onBlur",
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { handleSubmit } = methods;

  const onSubmit: SubmitHandler<SignInSchema> = async (data) => {
    setSubmitError(null);
    try {
      setIsLoading(true);
      const res = await signIn("credentials", {
        ...data,
        redirect: false,
      });
      // next-auth reports `ok` from the HTTP status, which is 200 even when
      // the credentials were rejected; the rejection only shows up in `error`.
      if (res?.error) {
        setSubmitError(
          res.error === "CredentialsSignin"
            ? WRONG_CREDENTIALS
            : "We couldn’t sign you in. Try again.",
        );
      } else if (res?.ok) {
        router.push("/dashboard");
        return;
      }
    } catch {
      setSubmitError(
        "We couldn’t reach Lexidraw. Check your connection and try again.",
      );
    }
    setIsLoading(false);
  };

  const handleGitHubSignin = async () => {
    setSubmitError(null);
    await signIn("github", { callbackUrl: "/dashboard" });
  };

  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="outline"
        onClick={handleGitHubSignin}
        className="w-full gap-2"
      >
        <GitHubMark className="size-4" />
        Continue with GitHub
      </Button>
      <AuthDivider />
      <FormProvider methods={methods} onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-4">
          <RHFTextField
            label="Email"
            name="email"
            type="email"
            autoComplete="username"
          />
          <RHFTextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
          />
        </div>
        <Button
          disabled={isLoading}
          type="submit"
          className="mt-6 w-full"
          pending={isLoading}
        >
          Sign in
        </Button>
        {submitError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {submitError}
          </p>
        )}
      </FormProvider>
    </div>
  );
}
