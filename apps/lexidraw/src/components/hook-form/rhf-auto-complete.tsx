"use client";

import type React from "react";
import { Controller, useFormContext } from "react-hook-form";

interface Option {
  label: string;
  value: string | number;
}

interface RHFAutocompleteProps {
  name: string;
  label?: string;
  options: Option[];
  placeholder?: string;
}

const RHFAutocomplete: React.FC<RHFAutocompleteProps> = ({
  name,
  label,
  options,
  placeholder,
}) => {
  const { control } = useFormContext();

  return (
    <div className="relative">
      {label && (
        <label
          htmlFor={name}
          className="block text-sm font-medium text-foreground"
        >
          {label}
        </label>
      )}
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <select
            {...field}
            id={name}
            className="mt-1 block w-full rounded-md border-input py-2 pl-3 pr-10 text-base focus:border-input focus:outline-hidden focus:ring-ring sm:text-sm"
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={String(option.value)} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      />
    </div>
  );
};

export default RHFAutocomplete;
