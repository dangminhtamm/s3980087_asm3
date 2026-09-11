import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface SignaturePadProps {
  value: string | null;
  onChange(value: string | null): void;
}

export const SignaturePad = ({ value, onChange }: SignaturePadProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    const image = new Image();
    image.onload = () =>
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
  }, [value]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * event.currentTarget.width) / bounds.width,
      y: ((event.clientY - bounds.top) * event.currentTarget.height) / bounds.height,
    };
  };
  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = point(event);
    event.currentTarget.getContext('2d')?.beginPath();
    event.currentTarget.getContext('2d')?.moveTo(next.x, next.y);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    const next = point(event);
    if (!context) return;
    context.strokeStyle = '#0f172a';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineTo(next.x, next.y);
    context.stroke();
  };
  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(event.currentTarget.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-500">Recipient signature</p>
        <button type="button" onClick={clear} className="text-[9px] font-bold text-teal-700">
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={720}
        height={220}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="mt-1 h-28 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-white"
        aria-label="Recipient signature pad"
      />
      <p className="mt-1 text-[9px] text-slate-400">
        {value ? 'Signature captured' : 'Sign inside the box'}
      </p>
    </div>
  );
};
