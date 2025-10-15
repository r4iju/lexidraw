"use client";

import type React from "react";
import { useFormContext, Controller } from "react-hook-form";

interface RHFCheckboxProps {
  name: string;
  helperText?: React.ReactNode;
  label: React.ReactNode;
}

export function RHFCheckbox({ name, helperText, label }: RHFCheckboxProps) {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <div className="flex items-center">
          <input
            type="checkbox"
            {...field}
            checked={field.value}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label className="ml-2 block text-sm text-gray-700">{label}</label>
          {error ? (
            <p className="mt-1 text-sm text-red-600">{error.message}</p>
          ) : (
            helperText && (
              <p className="mt-1 text-sm text-gray-600">{helperText}</p>
            )
          )}
        </div>
      )}
    />
  );
}

interface OptionType {
  label: string;
  value: string;
}

interface RHFMultiCheckboxProps {
  name: string;
  options: OptionType[];
  row?: boolean;
  label?: string;
  helperText?: React.ReactNode;
}

export function RHFMultiCheckbox({
  row,
  name,
  label,
  options,
  helperText,
}: RHFMultiCheckboxProps) {
  const { control } = useFormContext();

  const getSelected = (selectedItems: string[], item: string) =>
    selectedItems.includes(item)
      ? selectedItems.filter((value: string) => value !== item)
      : [...selectedItems, item];

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <div>
          {label && <legend className="text-lg font-medium">{label}</legend>}
          <div className={`flex ${row ? "flex-row" : "flex-col"}`}>
            {options.map((option) => (
              <label key={option.value} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={
                    Array.isArray(field.value) &&
                    field.value.includes(option.value)
                  }
                  onChange={() =>
                    Array.isArray(field.value) &&
                    field.onChange(getSelected(field.value, option.value))
                  }
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
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
