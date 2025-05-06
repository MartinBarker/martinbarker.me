'use client'

export default function RenderTuneLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <h1>RenderTune Layout Top</h1>
        {children}
        <h1>RenderTune Layout Bottom</h1>
      </body>
    </html>
  );
}