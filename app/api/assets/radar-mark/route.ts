const RADAR_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="Radar Carreira"><rect width="96" height="96" rx="24" fill="#fff"/><path d="M19 48a29 29 0 0 1 47-22" fill="none" stroke="#14274a" stroke-linecap="round" stroke-width="8"/><path d="M28 60a23 23 0 0 0 39-8" fill="none" stroke="#14274a" stroke-linecap="round" stroke-width="8"/><circle cx="47" cy="48" r="13" fill="#7457d9"/><path d="m45 52 31-31" stroke="#ff5a68" stroke-linecap="round" stroke-width="8"/><path d="m67 21 10 1-1 10" fill="none" stroke="#ff5a68" stroke-linecap="round" stroke-linejoin="round" stroke-width="6"/><circle cx="27" cy="71" r="4" fill="#ff5a68"/></svg>`;

export function GET() {
  return new Response(RADAR_MARK, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(new TextEncoder().encode(RADAR_MARK).byteLength),
    },
  });
}
