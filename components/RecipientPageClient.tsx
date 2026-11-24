'use client';
import { useEffect, useState } from 'react';
import { MotionProvider } from './Motion';
import RecipientExperience from './RecipientExperience';

export default function RecipientPageClient({ slug }: { slug: string }) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(
      localStorage.getItem('donjai-reduced') === 'true' ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduced);
  }, [reduced]);

  function toggleReduced() {
    setReduced((r) => {
      localStorage.setItem('donjai-reduced', String(!r));
      return !r;
    });
  }

  return (
    <MotionProvider reduced={reduced}>
      <div className="app view-recipient">
        <RecipientExperience
          giftSlugOrId={slug}
          reduced={reduced}
          onToggleReduced={toggleReduced}
          onGoHome={() => window.location.assign('/')}
        />
      </div>
    </MotionProvider>
  );
}
