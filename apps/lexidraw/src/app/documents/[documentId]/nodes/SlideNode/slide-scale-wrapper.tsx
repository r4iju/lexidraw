// slide-scale-wrapper.tsx
import React, {
  ReactNode,
  useLayoutEffect,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";

export const ScaleContext = createContext(1);
export const useCanvasScale = () => useContext(ScaleContext);

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

export const SlideScaleWrapper: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!outerRef.current) return;
    const outer = outerRef.current;

    const compute = () => {
      /*  only width matters → guarantees 16 : 9              */
      const w = outer.clientWidth;
      const newScale = Math.min(w / DESIGN_WIDTH, 1);
      setScale(newScale);

      /*  let the outer wrapper grow just enough for 16 : 9    */
      outer.style.height = `${DESIGN_HEIGHT * newScale}px`;
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(outer);
    window.addEventListener("resize", compute);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
    };
  }, []);

  return (
    <div ref={outerRef} className="w-full flex-shrink-0 overflow-hidden">
      <ScaleContext.Provider value={scale}>
        <div
          style={{
            width: DESIGN_WIDTH,
            height: DESIGN_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          className="relative"
        >
          {children}
        </div>
      </ScaleContext.Provider>
    </div>
  );
};
