import MetaTags from '../components/MetaTags';

export default function Home() {
  return (
    <>
      <MetaTags
        title="Home - My App"
        description="Welcome to the home page of My App."
        image="/path/to/home-preview-image.jpg"
        url="https://martinbarker.me/"
      />
    </>
  );
}