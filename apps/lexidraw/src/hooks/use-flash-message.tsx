import {
  type ShowFlashMessage,
  useFlashMessageContext,
} from "../app/documents/[documentId]/context/flash-message-context";

export default function useFlashMessage(): ShowFlashMessage {
  return useFlashMessageContext();
}
