"use client";

import { useRouter } from "next/navigation";

type Props = {
  drawingId: string;
};

export default function Redirect({ drawingId }: Props) {
  const router = useRouter();
  router.replace(`/drawings/${drawingId}`);
  return <></>;
}
