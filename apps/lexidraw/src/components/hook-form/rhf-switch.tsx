"use client";

import type { ReactNode } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { cn } from "~/lib/utils";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

interface RHFSwitchProps {
  name: string;
  disabled?: boolean;
  helperText?: ReactNode;
  label?: string;
  className?: string;
}

const RHFSwitch: React.FC<RHFSwitchProps> = ({
  name,
  helperText,
  label,
  className,
  disabled,
}) => {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <div className={cn("flex items-center py-2", className)}>
          <Switch
            {...field}
            id={name}
            checked={field.value}
            onCheckedChange={field.onChange}
            disabled={disabled}
          />
          {label && (
            <Label htmlFor={name} className="ml-4 text-sm text-foreground">
              {label}
            </Label>
          )}
          {error && (
            <p className="mt-1 text-sm text-destructive dark:font-semibold">
              {error.message}
            </p>
          )}
          {helperText && !error && (
            <p className="mt-1 text-sm text-muted-foreground">{helperText}</p>
          )}
        </div>
      )}
    />
  );
};

export default RHFSwitch;
