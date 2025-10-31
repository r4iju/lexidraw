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

// RHFSelect
interface RHFSelectProps {
  name: string;
  label?: string;
  helperText?: React.ReactNode;
  children: React.ReactNode;
}

export function RHFSelect({
  name,
  helperText,
  label,
  children,
}: RHFSelectProps) {
  const { control } = useFormContext();

  return (
    <div className="mx-1">
      {label && <Label htmlFor={name}>{label}</Label>}
      <Controller
        name={name}
        control={control}
        render={({ field, fieldState: { error } }) => (
          <div>
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
              <SelectTrigger id={name}>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>{children}</SelectContent>
            </Select>
            {error && (
              <p className="mt-1 text-sm text-destructive">{error.message}</p>
            )}
            {helperText && !error && (
              <p className="mt-1 text-sm text-muted-foreground">{helperText}</p>
            )}
          </div>
        )}
      />
    </div>
  );
}

// RHFMultiSelect
interface OptionType {
  label: string;
  value: string;
}

interface RHFMultiSelectProps {
  name: string;
  options: OptionType[];
  helperText?: React.ReactNode;
}

export function RHFMultiSelect({
  name,
  options,
  helperText,
}: RHFMultiSelectProps) {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <div>
          <select
            {...field}
            multiple
            className="form-multiselect mt-1 block w-full rounded-md border-gray-300 shadow-xs focus:border-indigo-300 focus:ring-3 focus:ring-indigo-200 focus:ring-opacity-50"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {error ? (
            <p className="mt-1 text-sm text-red-600">{error.message}</p>
          ) : (
            <p className="mt-1 text-sm text-gray-600">{helperText}</p>
          )}
        </div>
      )}
    />
  );
}
