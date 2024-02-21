"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import React from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { SignUpSchema } from "./schema";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";
import FormProvider from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { RHFTextField } from "~/components/hook-form";
import { useToast } from "~/components/ui/use-toast";
import { getDefaults } from "~/lib/get-zod-defaults";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { signIn } from "next-auth/react";

export default function SignUpForm() {
  const { toast } = useToast();
  const methods = useForm<SignUpSchema>({
    resolver: zodResolver(SignUpSchema),
    defaultValues: getDefaults(SignUpSchema) as SignUpSchema,
    mode: "onBlur",
  });
  const { handleSubmit } = methods;
  const { mutate } = api.auth.signUp.useMutation();
  const router = useRouter();

  const onSubmit: SubmitHandler<SignUpSchema> = (data) => {
    mutate(
      {
        email: data.email,
        password: data.password,
        name: data.name,
      },
      {
        onSuccess: () => {
          console.log("success");
          toast({
            title: "Account created.",
            description: "You may now login.",
          });
          router.push("/auth/signin");
        },
        onError: (err) => {
          console.log("error", err);
        },
      },
    );
  };

  const handleGitHubSignup = async () => {
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
        <div className="space-y-4 py-4">
          <RHFTextField name="name" label="Name" autoComplete="name" />
          <RHFTextField name="email" label="Email" type="email" />
          <RHFTextField name="password" label="Password" type="password" />
        </div>
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </FormProvider>
    </div>
  );
}
