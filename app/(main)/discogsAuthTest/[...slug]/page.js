import discogsAuthTestPage from '../page';
import { getRouteInfo } from '../../routeInfo';
import { redirect } from 'next/navigation';

// This file receives the slug param and passes it as a prop to discogsAuthTestPage
export default async function discogsAuthSlugPage({ params, searchParams }) {
  // Extract all query params from searchParams (Next.js 13+)
  // const urlVars = {};
  // if (searchParams) {
  //   for (const [key, value] of Object.entries(searchParams)) {
  //     urlVars[key] = value;
  //   }
  // }

  return (
    <discogsAuthTestPage testString='debug1' />
  );
}
