"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { type SubmitHandler, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { getSignInSchema, type SignInSchema } from "./schema";
import FormProvider from "~/components/hook-form";
import { RHFTextField } from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { getDefaults } from "@packages/lib";
import { GitHubLogoIcon, ReloadIcon } from "@radix-ui/react-icons";
import { cn } from "~/lib/utils";

export default function SignInForm() {
  const schema = getSignInSchema();

  const methods = useForm({
    resolver: standardSchemaResolver(schema),
    defaultValues: getDefaults(schema),
    mode: "onBlur",
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string>("/dashboard");
  const searchParams = useSearchParams();

  useEffect(() => {
    try {
      const disallowed = ["/signin", "/signup", "/signout", "/error"]; // avoid loops
      const isSameOrigin = (u: string): boolean => {
        const parsed = new URL(u, window.location.origin);
        return parsed.origin === window.location.origin;
      };
      const toPath = (u: string): string => {
        const parsed = new URL(u, window.location.origin);
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      };

      let dest: string | null = null;
      const fromParam = searchParams.get("callbackUrl");
      if (fromParam && isSameOrigin(fromParam)) dest = toPath(fromParam);
      else if (document.referrer && isSameOrigin(document.referrer))
        dest = toPath(document.referrer);
      else if (
        window.location.pathname &&
        !disallowed.some((p) => window.location.pathname.startsWith(p))
      )
        dest = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (!dest || disallowed.some((p) => dest!.startsWith(p))) dest = "/dashboard";
      setCallbackUrl(dest);
    } catch {
      setCallbackUrl("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { handleSubmit } = methods;

  const onSubmit: SubmitHandler<SignInSchema> = async (data) => {
    try {
      setIsLoading(true);
      await signIn("credentials", {
        ...data,
        callbackUrl,
        redirect: true,
      });
    } catch (err) {
      if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("An error occurred");
      }
    }
    setIsLoading(false);
  };

  const handleGitHubSignin = async () => {
    try {
      await signIn("github", {
        callbackUrl,
        redirect: true,
      });
    } catch (err) {
      if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("An error occurred");
      }
    }
  };

  return (
    <div>
      <Button onClick={handleGitHubSignin} className="w-full">
        <GitHubLogoIcon className="mr-4" />
        Sign in with GitHub
      </Button>
      <FormProvider methods={methods} onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-4 py-4">
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
        <Button disabled={isLoading} type="submit" className="w-full mt-6">
          <ReloadIcon
            className={cn("animate-spin w-4 mr-2", {
              "opacity-100": isLoading,
              "opacity-0": !isLoading,
            })}
          />
          Sign In
          <div className="w-4 ml-2 opacity-0" />
        </Button>
        {submitError && (
          <div className="text-center">
            <span className="text-destructive">{submitError}</span>
          </div>
        )}
      </FormProvider>
    </div>
  );
}
