"use client";

import type React from "react";
import { useFormContext, Controller } from "react-hook-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Label } from "~/components/ui/label";

interface RHFModelSelectProps {
  name: string;
  label?: string;
  helperText?: React.ReactNode;
  providerName: string; // Name of the provider field (e.g., "chat.provider")
  allowedModels: Array<{ provider: string; modelId: string }>;
}

export function RHFModelSelect({
  name,
  label,
  helperText,
  providerName,
  allowedModels,
}: RHFModelSelectProps) {
  const { control, watch } = useFormContext();
  const provider = watch(providerName);

  // Filter models by selected provider
  const filteredModels = provider
    ? allowedModels.filter((m) => m.provider === provider)
    : [];

  return (
    <div className="mx-1">
      {label && <Label htmlFor={name}>{label}</Label>}
      <Controller
        name={name}
        control={control}
        render={({ field, fieldState: { error } }) => {
          const currentValue = field.value ?? "";
          const hasValidModel =
            currentValue &&
            filteredModels.some((m) => m.modelId === currentValue);

          return (
            <div>
              <Select
                value={hasValidModel ? currentValue : ""}
                onValueChange={field.onChange}
                disabled={!provider || filteredModels.length === 0}
              >
                <SelectTrigger id={name}>
                  <SelectValue
                    placeholder={
                      !provider
                        ? "Select provider first"
                        : filteredModels.length === 0
                          ? "No models available"
                          : "Select model"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {filteredModels.map((model) => (
                    <SelectItem key={model.modelId} value={model.modelId}>
                      {model.modelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error && (
                <p className="mt-1 text-sm text-destructive">{error.message}</p>
              )}
              {helperText && !error && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {helperText}
                </p>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
