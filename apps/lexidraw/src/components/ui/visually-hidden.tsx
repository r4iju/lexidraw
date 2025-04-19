import { VisuallyHidden as VisuallyHiddenPrimitive } from "@radix-ui/react-visually-hidden";

type Props = {
  children: React.ReactNode;
};

export function VisuallyHidden({ children }: Props) {
  return <VisuallyHiddenPrimitive>{children}</VisuallyHiddenPrimitive>;
}

export function VisuallyHiddenContent({ children }: Props) {
  return <div className="sr-only contents">{children}</div>;
}
