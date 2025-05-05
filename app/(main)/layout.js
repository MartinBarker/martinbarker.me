import Link from 'next/link'

export default function MainLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ border: '5px solid blue', padding: '10px' }}>
        <h1>Root Layout Top</h1>
        <Link href="/"><button>Home</button></Link>
        <Link href="/rendertune"><button>RenderTune</button></Link>
        {children}
        <h1>Root Layout Bottom</h1>
      </body>
    </html>
  )
}
