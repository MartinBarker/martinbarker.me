import TaggerPage from '../page';
import { getRouteInfo } from '../../routeInfo';

// This file receives the slug param and passes it as a prop to TaggerPage
export default async function TaggerSlugPage({ params }) {
  // Await the params object before accessing its properties
  const resolvedParams = await params;
  const slugArray = resolvedParams.slug;
  
  // params.slug is an array of path segments - join them to form the URL
  // Replace the first segment with "https://" or "http://" if it's a protocol identifier
  let urlFromSlug;
  
  if (slugArray[0] === 'https:' || slugArray[0] === 'http:') {
    // If the first part is a protocol, reconstruct the URL with proper format
    const protocol = slugArray[0].replace(':', '');
    urlFromSlug = `${protocol}://${slugArray.slice(1).join('/')}`;
  } else {
    // Otherwise just join all segments
    urlFromSlug = slugArray.join('/');
  }
  
  // URL decode the value to handle percent-encoded characters
  urlFromSlug = decodeURIComponent(urlFromSlug);
  
  
  // Access the shared route info - it will use the "/tagger" path info
  const routeInfo = getRouteInfo(`/tagger/${slugArray.join('/')}`);
  
  // Pass both URL and route info to the TaggerPage component
  return <TaggerPage initialUrl={urlFromSlug} routeInfo={routeInfo} />;
}
 