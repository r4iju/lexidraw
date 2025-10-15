"use client";

import { useParams } from "next/navigation";

export function useEntityId() {
  const { documentId, drawingId } = useParams<{
    documentId: string;
    drawingId: string;
  }>();

  const id = documentId || drawingId;

  return id;
}
