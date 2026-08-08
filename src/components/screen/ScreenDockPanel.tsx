import { useEffect, useRef, type MouseEvent } from "react";
import { useDockStore } from "../../state/useDockStore";
import { ScreenView } from "./ScreenView";

const MIN_WIDTH = 280;
const MAX_WIDTH = 900;

export function ScreenDockPanel() {
  const width = useDockStore((s) => s.width);
  const setWidth = useDockStore((s) => s.setWidth);
  const setOpen = useDockStore((s) => s.setOpen);
  const draggingRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!draggingRef.current) return;
      // The panel is anchored to the right edge, so its width is the distance from the
      // pointer to the window's right edge.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      setWidth(next);
    };
    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setWidth]);

  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="flex shrink-0" style={{ width }}>
      <div
        onMouseDown={startResize}
        className="w-1.5 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-emerald-700"
        title="Drag to resize"
      />
      <div className="min-h-0 min-w-0 flex-1">
        <ScreenView onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
