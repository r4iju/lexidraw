'use client';

import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';

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
          className="block text-sm font-medium text-gray-700"
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
            className="mt-1 block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-hidden focus:ring-indigo-500 sm:text-sm"
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option, index) => (
              <option key={index} value={option.value}>
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
