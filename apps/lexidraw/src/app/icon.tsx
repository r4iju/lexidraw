import { appIconImage } from "~/components/icons/app-icon-image";

export const size = { width: 512, height: 512 };

// ImageResponse always renders a PNG.
export const contentType = "image/png";

export default function Icon() {
  return appIconImage(size);
}
