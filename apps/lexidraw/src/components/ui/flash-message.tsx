import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export interface FlashMessageProps {
  children: ReactNode;
}

export default function FlashMessage({
  children,
}: FlashMessageProps): React.JSX.Element {
  return createPortal(
    <div
      className="fixed inset-0 flex justify-center items-center pointer-events-none top-0 bottom-0 left-0 right-0"
      role="dialog"
    >
      <p
        className="bg-black text-white p-2 rounded-md font-medium text-lg px-4 py-2"
        role="alert"
      >
        {children}
      </p>
    </div>,
    document.body,
  );
}
