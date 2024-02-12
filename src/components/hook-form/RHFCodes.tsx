"use client";

// react
import { useRef, type ChangeEvent, type FC } from "react";
// hooks
import { useFormContext, Controller } from "react-hook-form";
import useEventListener from "~/hooks/useEventListener";

type Props = {
  keyName: string;
  inputs: string[];
};

const RHFCodes: FC<Props> = ({ keyName = "", inputs = [], ...other }) => {
  const codesRef = useRef<HTMLDivElement>(null);
  const { control, setValue } = useFormContext();

  const handleChangeWithNextField = (
    event: ChangeEvent<HTMLInputElement>,
    handleChange: (event: ChangeEvent<HTMLInputElement>) => void,
  ) => {
    const { maxLength, value, name } = event.target;
    const fieldIndex = name.replace(keyName, "");
    const fieldIntIndex = Number(fieldIndex);
    const nextField: HTMLElement | null = document.querySelector(
      `input[name=${keyName}${fieldIntIndex + 1}]`,
    );

    if (value.length >= maxLength && nextField) {
      nextField.focus();
    }

    handleChange(event);
  };

  const handlePaste = (event: ClipboardEvent) => {
    const dataString = event.clipboardData?.getData("text") ?? "";
    const data = dataString.split("");

    inputs.forEach((input, index) =>
      setValue(`${keyName}${index + 1}`, data[index]),
    );

    event.preventDefault();
  };

  useEventListener("paste", handlePaste, codesRef);

  return (
    <div className="flex justify-center space-x-2" ref={codesRef}>
      {inputs.map((name, index) => (
        <Controller
          key={name}
          name={`${keyName}${index + 1}`}
          control={control}
          render={({ field, fieldState: { error } }) => (
            <input
              {...field}
              autoFocus={index === 0}
              placeholder="-"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                handleChangeWithNextField(event, field.onChange);
              }}
              onFocus={(event) => event.currentTarget.select()}
              className={`h-9 w-9 border p-0 text-center ${
                error ? "border-red-500" : "border-gray-300"
              } rounded-md`}
              maxLength={1}
              type="number"
              {...other}
            />
          )}
        />
      ))}
    </div>
  );
};

export default RHFCodes;
