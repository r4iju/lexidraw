/** simply renders the first slide based on the data passed in, no editing */
import type React from "react";
import { useRef, useState, useEffect } from "react";
import type { LexicalEditor } from "lexical";
import type { SlideDeckData, SlideData } from "./SlideNode";
import SlideElementView from "./SlideElementView";
import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

interface SlideViewProps {
  initialData: SlideDeckData;
  editor: LexicalEditor;
}

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

const SlideView: React.FC<SlideViewProps> = ({ initialData, editor }) => {
  const [deckData, setDeckData] = useState<SlideDeckData>(() => {
    try {
      const parsed = { ...initialData };
      if (parsed.slides && Array.isArray(parsed.slides)) {
        parsed.slides = parsed.slides.map((slide: SlideData) => ({
          ...slide,
          elements: slide.elements
            ? slide.elements.map((el) => ({ ...el, version: el.version || 0 }))
            : [],
        }));
      } else {
        parsed.slides = [];
      }
      return parsed;
    } catch (error) {
      console.error(
        "[SlideView] Error parsing initialDataString in useState for deckData:",
        error,
      );
      throw error;
    }
  });

  const [viewingSlideIndex, setViewingSlideIndex] = useState(0);

  useEffect(() => {
    try {
      const parsed = { ...initialData };
      if (parsed.slides && Array.isArray(parsed.slides)) {
        parsed.slides = parsed.slides.map((slide: SlideData) => ({
          ...slide,
          elements: slide.elements
            ? slide.elements.map((el) => ({ ...el, version: el.version || 0 }))
            : [],
        }));
      } else {
        parsed.slides = [];
      }
      setDeckData(parsed);
      setViewingSlideIndex(0);
    } catch (error) {
      console.error("[SlideView] Error in useEffect from initialData: ", error);
      setViewingSlideIndex(0);
    }
  }, [initialData]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [actualWidth, setActualWidth] = useState(0);

  useEffect(() => {
    const updateActualWidth = () => {
      if (containerRef.current) {
        setActualWidth(containerRef.current.offsetWidth);
      }
    };

    if (containerRef.current) {
      updateActualWidth();
      const resizeObserver = new ResizeObserver(updateActualWidth);
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  const scale = actualWidth > 0 ? actualWidth / DESIGN_WIDTH : 0;

  const handlePrevSlide = () => {
    setViewingSlideIndex((prevIndex) => Math.max(0, prevIndex - 1));
  };

  const handleNextSlide = () => {
    setViewingSlideIndex((prevIndex) =>
      Math.min(deckData.slides.length - 1, prevIndex + 1),
    );
  };

  if (!deckData || !deckData.slides || deckData.slides.length === 0) {
    // console.log("[SlideView] Rendering: No slides to display.");
    return (
      <div
        className="p-4 border border-dashed border-muted text-muted-foreground"
        style={{
          width: "100%",
          aspectRatio: `${DESIGN_WIDTH}/${DESIGN_HEIGHT}`,
          minHeight: "100px",
        }}
      >
        No slides to display.
      </div>
    );
  }

  const currentSlide = deckData.slides[viewingSlideIndex];
  // console.log("[SlideView] Rendering with viewingSlideIndex:", viewingSlideIndex, "currentSlide ID:", currentSlide?.id);

  if (!currentSlide) {
    // console.log("[SlideView] Rendering: Current slide data is missing for index", viewingSlideIndex);
    return (
      <div
        className="p-4 border border-dashed border-destructive text-destructive-foreground"
        style={{
          width: "100%",
          aspectRatio: `${DESIGN_WIDTH}/${DESIGN_HEIGHT}`,
          minHeight: "100px",
        }}
      >
        Slide data is missing for index {viewingSlideIndex}.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="slide-view-outer-viewport bg-muted/10 border border-border relative"
      style={{
        width: "100%",
        aspectRatio: `${DESIGN_WIDTH}/${DESIGN_HEIGHT}`,
        overflow: "hidden",
      }}
    >
      <div
        className="slide-view-scaling-container bg-background"
        style={{
          width: `${DESIGN_WIDTH}px`,
          height: `${DESIGN_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          position: "relative",
          backgroundColor: currentSlide.backgroundColor || "transparent",
        }}
      >
        {currentSlide.elements.map((element) => (
          <SlideElementView
            key={`${currentSlide.id}-${element.id}-${element.version}`}
            element={element}
            parentEditor={editor}
          />
        ))}
      </div>

      {/* slide Navigation Controls */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-2 p-2">
        <Button
          onClick={handlePrevSlide}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          disabled={viewingSlideIndex <= 0}
          variant="outline"
          size="icon"
          title="Previous Slide"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </Button>
        <span className="text-sm text-muted-foreground select-none">
          Slide {viewingSlideIndex + 1} of {deckData.slides.length}
        </span>
        <Button
          onClick={handleNextSlide}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          disabled={viewingSlideIndex >= deckData.slides.length - 1}
          variant="outline"
          size="icon"
          title="Next Slide"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

export default SlideView;
