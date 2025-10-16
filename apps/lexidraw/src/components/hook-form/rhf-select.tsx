"use client";

import type React from "react";
import { useFormContext, Controller } from "react-hook-form";
import { Select } from "~/components/ui/select";

// RHFSelect
interface RHFSelectProps {
  name: string;
  label?: string; // New label prop
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
      {label && (
        <label
          htmlFor={name}
          className="mb-1 block text-sm font-medium text-gray-200"
        >
          {label}
        </label>
      )}
      <Controller
        name={name}
        control={control}
        render={({ field, fieldState: { error } }) => (
          <div>
            <Select id={name} {...field}>
              {children}
            </Select>
            {error ? (
              <p className="mt-1 text-sm text-red-600">{error.message}</p>
            ) : (
              <p className="mt-1 text-sm text-gray-600">{helperText}</p>
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
