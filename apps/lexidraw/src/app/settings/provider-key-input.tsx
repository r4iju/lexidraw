import type { ComponentProps } from "react";
import { Input } from "~/components/ui/input";
export function ProviderKeyInput({
  disabled,
}: Pick<ComponentProps<typeof Input>, "disabled">) {
  return (
    <Input
      id="provider-key"
      type="password"
      autoComplete="off"
      required
      maxLength={1024}
      disabled={disabled}
    />
  );
}
