/** simply renders the first slide based on the data passed in, no editing */
import React, { useRef, useState, useEffect } from "react";
import { LexicalEditor } from "lexical";
import type { SlideDeckData, SlideData } from "./SlideNode";
import SlideElementView from "./SlideElementView";
import { DEFAULT_SLIDE_DECK_DATA } from "./SlideNode";
import { Button } from "~/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

interface SlideViewProps {
  initialDataString: string;
  editor: LexicalEditor;
}

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

const SlideView: React.FC<SlideViewProps> = ({ initialDataString, editor }) => {
  const [deckData, setDeckData] = useState<SlideDeckData>(() => {
    try {
      const parsed = JSON.parse(initialDataString);
      if (parsed.slides && Array.isArray(parsed.slides)) {
        parsed.slides = parsed.slides.map((s: SlideData) => ({
          ...s,
          elements: s.elements || [],
        }));
      } else {
        parsed.slides = [];
      }
      return parsed;
    } catch (e) {
      console.error("Error parsing slide data in SlideView: ", e);
      return { ...DEFAULT_SLIDE_DECK_DATA };
    }
  });

  const [viewingSlideIndex, setViewingSlideIndex] = useState(0);

  useEffect(() => {
    try {
      const parsed = JSON.parse(initialDataString);
      if (parsed.slides && Array.isArray(parsed.slides)) {
        parsed.slides = parsed.slides.map((s: SlideData) => ({
          ...s,
          elements: s.elements || [],
        }));
      } else {
        parsed.slides = [];
      }
      setDeckData(parsed);
      setViewingSlideIndex(0);
    } catch (e) {
      console.error(
        "Error updating slide data in SlideView from initialDataString: ",
        e,
      );
      setDeckData({ ...DEFAULT_SLIDE_DECK_DATA });
      setViewingSlideIndex(0);
    }
  }, [initialDataString]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [actualWidth, setActualWidth] = useState(0);

  useEffect(() => {
    const updateActualWidth = () => {
      if (containerRef.current) {
        setActualWidth(containerRef.current.offsetWidth);
      }
    };

    if (containerRef.current) {
      updateActualWidth(); // Initial width
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

  if (!currentSlide) {
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
        }}
      >
        {currentSlide.elements.map((element) => (
          <SlideElementView
            key={`${currentSlide.id}-${element.id}`}
            element={element}
            parentEditor={editor}
          />
        ))}
      </div>

      {/* slide Navigation Controls */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-2 p-2">
        <Button
          onClick={handlePrevSlide}
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
