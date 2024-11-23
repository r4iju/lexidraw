"use client";
// couldn't get redirect() from "next/navigation" to work

import { useRouter } from "next/navigation";

type Props = {
  documentId: string;
};

export default function Redirect({ documentId }: Props) {
  const router = useRouter();
  router.replace(`/documents/${documentId}`);
  return <></>;
}
