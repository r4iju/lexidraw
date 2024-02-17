"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ProfileSchema } from "./schema";
import FormProvider from "~/components/hook-form/FormProvider";
import { RHFTextField } from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { useToast } from "~/components/ui/use-toast";
import { RouterOutputs } from "~/trpc/shared";
import { useSession } from "next-auth/react";

type Props = {
  user: RouterOutputs["auth"]["getProfile"];
};

export default function SignInForm({ user }: Props) {
  const { data: session, update } = useSession();

  const { mutate: saveProfile, isLoading } =
    api.auth.updateProfile.useMutation();
  const { toast } = useToast();
  const methods = useForm<ProfileSchema>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      email: user!.email ?? "",
      name: user!.name ?? "",
    },
    mode: "onBlur",
  });

  const {
    reset,
    handleSubmit,
    formState: { isDirty },
  } = methods;

  const onSubmit = async (data: ProfileSchema) => {
    saveProfile(data, {
      onSuccess: async () => {
        toast({
          title: "Profile saved",
        });
        reset(data);
        await update({
          ...session,
          user: {
            ...session?.user,
            email: data.email,
            name: data.name,
          },
        });
      },
      onError: (error) => {
        toast({
          title: "Error saving profile",
          description: error.message,
          variant: "destructive",
        });
      },
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
          <RHFTextField label="Name" name="name" type="name" />
        </div>
        <Button
          className="w-full"
          type="submit"
          disabled={!isDirty || isLoading}
        >
          Save
        </Button>
      </FormProvider>
    </div>
  );
}
