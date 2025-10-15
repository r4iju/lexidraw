"use client";

import type { FormEvent } from "react";
import {
  FormProvider as Form,
  type UseFormReturn,
  type FieldValues,
} from "react-hook-form";

type Props<T extends FieldValues> = {
  children: React.ReactNode;
  methods: UseFormReturn<T>;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export default function FormProvider<T extends FieldValues>({
  children,
  onSubmit,
  methods,
}: Props<T>) {
  return (
    <Form {...methods}>
      <form onSubmit={onSubmit} className="space-y-4">
        {children}
      </form>
    </Form>
  );
}
