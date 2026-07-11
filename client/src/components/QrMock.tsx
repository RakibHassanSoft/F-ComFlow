// Phase 6: A Bangla-QR-style code for the sandbox invoice.
// Real integration renders the interoperable QR returned by SSLCOMMERZ;
// this draws a deterministic QR-like pattern from the invoice id so the
// demo looks right with zero external services.
'use client';

export function QrMock({ seed, size = 180 }: { seed: string; size?: number }) {
  const cells = 21;
  // Simple deterministic hash -> pseudo-random bits
  let h = 2166136261;
  const bit = (i: number) => {
    h ^= i + seed.charCodeAt(i % seed.length);
    h = Math.imul(h, 16777619);
    return (h >>> 15) % 5 < 2;
  };

  const squares: JSX.Element[] = [];
  const finder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= cells - 7 && y < 7) || (x < 7 && y >= cells - 7);

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (finder(x, y)) continue;
      if (bit(y * cells + x)) {
        squares.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
      }
    }
  }

  const Finder = ({ x, y }: { x: number; y: number }) => (
    <g>
      <rect x={x} y={y} width={7} height={7} fill="black" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="white" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="black" />
    </g>
  );

  return (
    <svg viewBox={`0 0 ${cells} ${cells}`} width={size} height={size} className="rounded-lg bg-white">
      <rect width={cells} height={cells} fill="white" />
      <g fill="black">{squares}</g>
      <Finder x={0} y={0} />
      <Finder x={cells - 7} y={0} />
      <Finder x={0} y={cells - 7} />
    </svg>
  );
}
