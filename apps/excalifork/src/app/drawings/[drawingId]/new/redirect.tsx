"use client";
// couldn't get redirect() from "next/navigation" to work

import { useRouter } from "next/navigation";

type Props = {
  drawingId: string;
};

export default function redirect({ drawingId }: Props) {
  const router = useRouter();
  router.push(`/drawings/${drawingId}`);
  return <></>;
}
