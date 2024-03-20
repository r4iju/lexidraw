"use client";
// couldn't get redirect() from "next/navigation" to work

import { useRouter } from "next/navigation";

type Props = {
  documentId: string;
};

export default function redirect({ documentId }: Props) {
  const router = useRouter();
  router.push(`/documents/${documentId}`);
  return <></>;
}
