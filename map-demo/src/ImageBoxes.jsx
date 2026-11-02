import { useEffect, useRef } from "react";

// Draws Gemini's box_2d ([ymin, xmin, ymax, xmax], 0-1000) over the photo.
export default function ImageBoxes({ src, findings = [] }) {
  const canvas = useRef(null);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const c = canvas.current;
      if (!c) return;
      const scale = Math.min(1, 900 / img.width);
      c.width = img.width * scale;
      c.height = img.height * scale;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      findings.forEach((f, i) => {
        if (!f.box_2d) return;
        const [ymin, xmin, ymax, xmax] = f.box_2d;
        const x = (xmin / 1000) * c.width, y = (ymin / 1000) * c.height;
        const w = ((xmax - xmin) / 1000) * c.width, h = ((ymax - ymin) / 1000) * c.height;
        const bad = f.status === "possible_issue";
        ctx.lineWidth = 3;
        ctx.strokeStyle = bad ? "#ff3b30" : "#34c759";
        ctx.strokeRect(x, y, w, h);
        const label = `${i + 1}. ${bad ? "possible issue" : "OK"}`;
        ctx.font = "bold 14px system-ui";
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = bad ? "#ff3b30" : "#34c759";
        ctx.fillRect(x, Math.max(0, y - 20), tw, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + 4, Math.max(14, y - 5));
      });
    };
    img.src = src;
  }, [src, findings]);

  if (!src) return null;
  return <canvas ref={canvas} className="boxes" />;
}
