"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useEffect, useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { getSignUpSchema, type SignUpSchema } from "./schema";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";
import FormProvider from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { RHFTextField } from "~/components/hook-form";
import { toast } from "sonner";
import { getDefaults } from "@packages/lib";
import { GitHubLogoIcon, ReloadIcon } from "@radix-ui/react-icons";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { cn } from "~/lib/utils";

export default function SignUpForm() {
  const schema = getSignUpSchema();
  const methods = useForm({
    resolver: standardSchemaResolver(schema),
    defaultValues: getDefaults(schema),
    mode: "onBlur",
  });
  const { handleSubmit } = methods;

  const { mutate, isPending } = api.auth.signUp.useMutation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
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
      if (!dest || disallowed.some((p) => dest!.startsWith(p))) dest = "/dashboard";
      setCallbackUrl(dest);
    } catch {
      setCallbackUrl("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit: SubmitHandler<SignUpSchema> = (data) => {
    setSubmitError(null);
    mutate(data, {
      onSuccess: () => {
        toast.success("Account created.", {
          description: "You may now login.",
        });
        router.push("/signin");
      },
      onError: (err) => {
        setSubmitError(err.message);
      },
    });
  };

  const handleGitHubSignup = async () => {
    setSubmitError(null);
    await signIn("github", {
      callbackUrl,
      redirect: true,
    });
  };

  return (
    <div>
      <Button onClick={handleGitHubSignup} className="w-full">
        <GitHubLogoIcon className="mr-4" />
        Sign in with GitHub
      </Button>
      <FormProvider methods={methods} onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-4 py-4 gap-y-4">
          <RHFTextField name="name" label="Name" autoComplete="name" />
          <RHFTextField name="email" label="Email" type="email" />
          <RHFTextField name="password" label="Password" type="password" />
        </div>
        <Button disabled={isPending} type="submit" className="w-full mt-6">
          <ReloadIcon
            className={cn("animate-spin w-4 mr-2", {
              "opacity-100": isPending,
              "opacity-0": !isPending,
            })}
          />
          Create account
          <div className="w-4 ml-2 opacity-0" />
        </Button>
        {submitError && (
          <div className="text-center">
            <span className="dark:text-red-300 text-red-600">
              {submitError}
            </span>
          </div>
        )}
      </FormProvider>
    </div>
  );
}
