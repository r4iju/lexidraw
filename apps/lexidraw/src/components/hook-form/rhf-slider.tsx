"use client";

import type React from "react";
import { useFormContext, Controller } from "react-hook-form";

type RHFSliderProps = {
  name: string;
  label?: string;
  helperText?: React.ReactNode;
  min?: number;
  max?: number;
  step?: number;
};

const RHFSlider: React.FC<RHFSliderProps> = ({
  name,
  label,
  helperText,
  min = 0,
  max = 100,
  step = 1,
}) => {
  const { control } = useFormContext();

  return (
    <div className="mx-1">
      {label && (
        <label className="mb-2 block text-sm font-medium text-gray-200">
          {label}
        </label>
      )}
      <Controller
        name={name}
        control={control}
        render={({ field, fieldState: { error } }) => (
          <div>
            <input
              type="range"
              {...field}
              min={min}
              max={max}
              step={step}
              onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-gray-200 focus:accent-gray-100 focus:outline-hidden focus:ring-gray-500 dark:bg-gray-500"
            />
            {error && (
              <p className="mt-1 text-sm text-red-600">{error.message}</p>
            )}
            {helperText && !error && (
              <p className="mt-1 text-sm text-gray-600">{helperText}</p>
            )}
          </div>
        )}
      />
    </div>
  );
};

export default RHFSlider;
