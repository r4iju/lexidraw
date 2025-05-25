/** simply renders the first slide based on the data passed in, no editing */
import React from "react";
import type { SlideDeckData } from "./SlideNode";

interface SlideViewProps {
  initialDataString: string;
}

const SlideView: React.FC<SlideViewProps> = ({ initialDataString }) => {
  let deckData: SlideDeckData | null = null;
  try {
    deckData = JSON.parse(initialDataString);
  } catch (e) {
    console.error("Error parsing slide data in SlideView: ", e);
    // Optionally, render an error state or a default view
  }

  if (!deckData || deckData.slides.length === 0) {
    return (
      <div className="p-4 border border-dashed border-muted text-muted-foreground">
        No slides to display.
      </div>
    );
  }

  const firstSlide = deckData.slides[0];

  // Placeholder rendering for the first slide
  // TODO: Implement actual rendering of slide elements (boxes, text, etc.)
  return (
    <div className="slide-view-container p-2 border border-border bg-muted/10 aspect-[16/9]">
      <div className="text-sm text-center text-muted-foreground">
        Slide 1 of {deckData.slides.length} (Read-only View)
      </div>
      {/* Basic representation of elements */}
      {firstSlide?.elements?.map((element) => (
        <div
          key={element.id}
          style={{
            position: "absolute", // This will need a relative parent
            left: `${element.x}px`,
            top: `${element.y}px`,
            width: `${element.width}px`,
            height: `${element.height}px`,
            border: "1px solid #eee",
            backgroundColor: "#f9f9f9",
            overflow: "hidden",
            padding: "2px",
            fontSize: "10px",
            boxSizing: "border-box",
          }}
        >
          Element: {element.kind} ({element.id.substring(0, 6)})
          {/* Basic content placeholder. 
              In a real implementation, you'd parse element.editorStateJSON 
              and render the Lexical content here, probably in a read-only editor. */}
          {/* For now, just indicating presence of content */}
          {element.editorStateJSON && (
            <div className="text-xs italic">[content]</div>
          )}
        </div>
      ))}
    </div>
  );
};

export default SlideView;
