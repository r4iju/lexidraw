"use client";

import * as React from "react";
import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { ToastActionElement, ToastProps } from "./toast";
import * as ToastPrimitives from "@radix-ui/react-toast";

const TOAST_LIMIT = 1;

export type ToasterToast = ToastProps & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

type ToastAction =
  | { type: "ADD_TOAST"; toast: ToasterToast }
  | { type: "UPDATE_TOAST"; toast: Partial<ToasterToast> }
  | { type: "DISMISS_TOAST"; toastId?: string }
  | { type: "REMOVE_TOAST"; toastId?: string };

interface ToastState {
  toasts: ToasterToast[];
}

interface ToastContextValue {
  state: ToastState;
  dispatch: React.Dispatch<ToastAction>;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toastReducer = (state: ToastState, action: ToastAction): ToastState => {
    switch (action.type) {
      case "ADD_TOAST":
        return {
          ...state,
          toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
        };

      case "UPDATE_TOAST":
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.id === action.toast.id ? { ...t, ...action.toast } : t,
          ),
        };

      case "DISMISS_TOAST": {
        const { toastId } = action;
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.id === toastId || toastId === undefined
              ? { ...t, open: false }
              : t,
          ),
        };
      }

      case "REMOVE_TOAST": {
        const { toastId } = action;
        if (!toastId) {
          return { ...state, toasts: [] };
        }
        return {
          ...state,
          toasts: state.toasts.filter((t) => t.id !== toastId),
        };
      }

      default:
        return state;
    }
  };

  const [state, dispatch] = React.useReducer(toastReducer, { toasts: [] });

  return (
    <ToastPrimitives.Provider>
      <ToastContext.Provider value={{ state, dispatch }}>
        {children}
      </ToastContext.Provider>
    </ToastPrimitives.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  const { state, dispatch } = context;

  const toast = useCallback(
    (props: Omit<ToasterToast, "id">) => {
      const id = uuidv4();

      dispatch({
        type: "ADD_TOAST",
        toast: {
          ...props,
          id,
          open: true,
        },
      });

      return {
        id,
        dismiss: () => dispatch({ type: "DISMISS_TOAST", toastId: id }),
        update: (updated: Partial<ToasterToast>) =>
          dispatch({
            type: "UPDATE_TOAST",
            toast: { ...updated, id },
          }),
      };
    },
    [dispatch],
  );

  const dismiss = useCallback(
    (toastId?: string) => {
      dispatch({ type: "DISMISS_TOAST", toastId });
    },
    [dispatch],
  );

  return {
    toasts: state.toasts,
    toast,
    dismiss,
    dispatch,
  };
}
