"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import React, { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { SignUpSchema } from "./schema";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";
import FormProvider from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { RHFTextField } from "~/components/hook-form";
import { useToast } from "~/components/ui/toast-provider";
import { getDefaults } from "@packages/lib";
import { GitHubLogoIcon, ReloadIcon } from "@radix-ui/react-icons";
import { signIn } from "next-auth/react";
import { cn } from "~/lib/utils";

export default function SignUpForm() {
  const { toast } = useToast();
  const methods = useForm<SignUpSchema>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: getDefaults(SignUpSchema) as SignUpSchema,
    mode: "onBlur",
  });
  const { handleSubmit } = methods;
  const { mutate, isPending } = api.auth.signUp.useMutation();
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit: SubmitHandler<SignUpSchema> = (data) => {
    setSubmitError(null);
    mutate(
      {
        email: data.email,
        password: data.password,
        name: data.name,
      },
      {
        onSuccess: () => {
          toast({
            title: "Account created.",
            description: "You may now login.",
          });
          router.push("/signin");
        },
        onError: (err) => {
          setSubmitError(err.message);
        },
      },
    );
  };

  const handleGitHubSignup = async () => {
    setSubmitError(null);
    await signIn("github", {
      callbackUrl: "/dashboard",
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
