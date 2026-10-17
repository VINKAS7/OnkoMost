/** Small line icons (24×24 grid, stroke = currentColor), sized and coloured by the `.ico` class. */
const PATHS: Record<string, string[]> = {
  bolt: ["M13 2 4 14h7l-1 8 9-12h-7l1-8Z"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z", "M14 3v5h5", "M9 13h6", "M9 17h4"],
  check: ["M20 6 9 17l-5-5"],
  checkSquare: ["M9 11l3 3 8-8", "M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"],
  split: ["M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6", "M18 3v6a6 6 0 0 1-6 6", "M3 6l3-3 3 3", "M15 6l3-3 3 3"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  arrow: ["M5 12h14", "m12 5 7 7-7 7"],
  flag: ["M4 22V4", "M4 4h13l-2 4 2 4H4"],
  send: ["m22 2-7 20-4-9-9-4 20-7Z", "M22 2 11 13"],
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"],
  route: ["M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M8 17h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8"],
  vote: ["m9 12 2 2 4-4", "M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5V7Z", "M22 19H2"],
  calendar: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"],
  stethoscope: ["M5 3v6a5 5 0 0 0 10 0V3", "M10 14v2a5 5 0 0 0 10 0v-3", "M20 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  hospital: ["M3 21h18", "M5 21V7l7-4 7 4v14", "M12 9v6", "M9 12h6"],
  bridge: ["M3 18h18", "M5 18v-5", "M19 18v-5", "M12 18v-8", "M3 13c3-5 15-5 18 0"],
  chevron: ["m9 18 6-6-6-6"],
  x: ["M18 6 6 18", "M6 6l12 12"],
  plus: ["M12 5v14", "M5 12h14"],
  pencil: ["M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"],
  filter: ["M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"],
  bell: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  layers: ["m12 2 10 5-10 5L2 7l10-5Z", "m2 17 10 5 10-5", "m2 12 10 5 10-5"],
  pointer: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"],
  spark: ["M12 3 13.6 8.4 19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z", "M19 3l.75 2.25L22 6l-2.25.75L19 9l-.75-2.25L16 6l2.25-.75L19 3Z"],
  folder: ["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],
};

export function Icon({ name, className = "" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg className={`ico ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {(PATHS[name] ?? PATHS.file).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
