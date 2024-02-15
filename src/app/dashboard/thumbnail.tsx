import Image from "next/image";
import { api } from "~/trpc/server";

type Props = {
  drawingId: string;
};

export async function Thumbnail({ drawingId }: Props) {
  const svg = await api.snapshot.get.query({ drawingId });
  const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return (
    <>
      <Image
        src={svgDataUrl}
        alt={`Thumbnail for ${drawingId}`}
        className="aspect-[4/3] h-auto w-full"
        width={500}
        height={400}
      />
    </>
  );
}
