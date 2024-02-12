"use client";

import { signIn } from "next-auth/react";
import React from "react";
import { type FieldValues, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SignInSchema } from "./schema";
import FormProvider from "~/components/hook-form/FormProvider";
import { RHFTextField } from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { getDefaults } from "~/lib/get-zod-defaults";

export default function SignInForm() {
  const methods = useForm<SignInSchema>({
    resolver: zodResolver(SignInSchema),
    defaultValues: getDefaults(SignInSchema) as SignInSchema,
    mode: "onBlur",
  });

  const { handleSubmit } = methods;

  const onSubmit = async (data: FieldValues) => {
    await signIn("credentials", {
      ...data,
      callbackUrl: "/dashboard",
      redirect: true,
    });
  };

  return (
    <div>
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
        <Button className="w-full" type="submit">
          Sign In
        </Button>
      </FormProvider>
    </div>
  );
}
