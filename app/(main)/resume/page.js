'use client'
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ResumeRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Try multiple possible filenames
    const possibleFilenames = [
      '/Martin%20Barker%20Resume.pdf',
      '/Martin_Barker_Resume.pdf',
      '/Martin Barker Resume.pdf'
    ];

    // Try to redirect to the first available file
    const tryRedirect = async (index = 0) => {
      if (index >= possibleFilenames.length) {
        // If none work, redirect to home
        router.push('/');
        return;
      }

      try {
        const response = await fetch(possibleFilenames[index], { method: 'HEAD' });
        if (response.ok) {
          window.location.href = possibleFilenames[index];
        } else {
          tryRedirect(index + 1);
        }
      } catch (error) {
        tryRedirect(index + 1);
      }
    };

    tryRedirect();
  }, [router]);

  // Return nothing - completely invisible redirect
  return null;
}
