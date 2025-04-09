"use client";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
} from "~/components/ui/toast";

import { useToast } from "./toast-provider";

export function Toaster() {
  const { toasts, dispatch } = useToast();

  return (
    <>
      {toasts.map(({ id, open, title, description, action, ...props }) => (
        <Toast
          key={id}
          open={open}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              dispatch({ type: "REMOVE_TOAST", toastId: id });
            }
          }}
          {...props}
        >
          <div className="grid gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </>
  );
}
