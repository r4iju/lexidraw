import { ImageResponse } from "next/og";
import { AppMark } from "~/components/icons/app-icon-image";

export const alt =
  "Lexidraw: write documents and sketch diagrams in one place.";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

/** The card a link to the site shows where no page has a picture of its own. */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 40,
        width: "100%",
        height: "100%",
        padding: "0 96px",
        backgroundColor: "#fafafb",
        color: "#26262b",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <AppMark width={96} height={102} />
        <span style={{ fontSize: 72 }}>Lexidraw</span>
      </div>
      <span style={{ fontSize: 48, lineHeight: 1.25, maxWidth: 900 }}>
        Write documents and sketch diagrams in one place.
      </span>
      <span style={{ fontSize: 30, color: "#6b6b76" }}>
        Rich text, slides and hand-drawn diagrams, shared with a link.
      </span>
    </div>,
    size,
  );
}
