"use client";

import type React from "react";
import { useFormContext, Controller } from "react-hook-form";

interface Option {
  label: string;
  value: string | number;
}

interface RHFRadioGroupProps {
  name: string;
  options: Option[];
  label?: string;
  spacing?: number;
  helperText?: React.ReactNode;
  row?: boolean;
}

const RHFRadioGroup: React.FC<RHFRadioGroupProps> = ({
  name,
  options,
  label,
  spacing,
  helperText,
  row,
}) => {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <fieldset>
          {label && <legend className="text-lg font-medium">{label}</legend>}
          <div
            className={`flex ${row ? "flex-row" : "flex-col"} space-x-${
              spacing ?? 2
            }`}
          >
            {options.map((option) => (
              <label key={option.value} className="flex items-center space-x-2">
                <input
                  type="radio"
                  {...field}
                  value={option.value}
                  checked={field.value === option.value}
                  className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-600">{error.message}</p>
          )}
          {helperText && !error && (
            <p className="mt-2 text-sm text-gray-600">{helperText}</p>
          )}
        </fieldset>
      )}
    />
  );
};

export default RHFRadioGroup;
