"use client";

import { type ReactNode } from "react";
import { useFormContext, Controller } from "react-hook-form";

interface RHFSwitchProps {
  name: string;
  helperText?: ReactNode;
  label?: string;
}

const RHFSwitch: React.FC<RHFSwitchProps> = ({ name, helperText, label }) => {
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
            id={name}
            className="h-4 w-4 checked:bg-blue-600"
            checked={field.value}
            role="switch"
          />
          {label && (
            <label htmlFor={name} className="ml-2 text-sm text-gray-700">
              {label}
            </label>
          )}
          {error && (
            <p className="mt-1 text-sm text-red-600">{error.message}</p>
          )}
          {helperText && !error && (
            <p className="mt-1 text-sm text-gray-600">{helperText}</p>
          )}
        </div>
      )}
    />
  );
};

export default RHFSwitch;
