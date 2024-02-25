"use client";

import { type FC } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { Textarea } from "~/components/ui/textarea";
import { Input } from "~/components/ui/input";
import { Label } from "../ui/label";

interface RHFTextFieldProps {
  name: string;
  autoComplete?: string;
  helperText?: React.ReactNode;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
}

const RHFTextField: FC<RHFTextFieldProps> = ({
  name,
  autoComplete,
  helperText,
  type = "text",
  placeholder,
  label,
  multiline,
  rows,
  required = false,
}) => {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        return (
          <div className="mx-1">
            {label && <Label>{label}</Label>}
            {multiline ? (
              <Textarea
                // className="dark:bg-gray-50 dark:text-black"
                {...field}
                id={name}
                autoComplete={autoComplete}
                rows={rows ?? 3}
                placeholder={placeholder}
                required={required}
              />
            ) : (
              <Input
                // className="dark:bg-gray-50 dark:text-black"
                {...field}
                id={name}
                autoComplete={autoComplete}
                type={type}
                placeholder={placeholder}
                required={required}
                value={
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  typeof field.value === "number" && field.value === 0
                    ? ""
                    : field.value
                }
              />
            )}
            {error && (
              <p className="mt-1 text-sm text-red-600">{error.message}</p>
            )}
            {helperText && !error && (
              <p className="mt-1 text-sm text-gray-600">{helperText}</p>
            )}
          </div>
        );
      }}
    />
  );
};

export default RHFTextField;
