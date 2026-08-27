// Headquarters — the building on the entry screen.
//
// WHY THIS IS A DRAWING AND NOT A PHOTOGRAPH. A photograph of the KSP headquarters would be
// better here and I do not have one to give you. Pulling a picture of a real government
// building off the web into a shipped product is a licensing problem wearing a nice suit, so
// this draws the civic architecture instead: the dome, the arcaded colonnade, the wide steps
// that every Karnataka state building shares with the Vidhana Soudha. It reads as institutional
// without impersonating a specific address.
//
// IT IS ALSO A SLOT. Drop a real photo at client/public/ksp-hq.jpg and it is used instead --
// no code change. That is what the <img> with onError is doing: try the photo, and if it is
// not there fall through to the drawing. Which means when you have a photograph you are
// cleared to use, adding it is a copy command.
//
// The photograph is shown in FULL COLOUR, cropped to the building and masked at the top so the
// sky dissolves into the page rather than ending in a hard horizon. The drawing that stands in
// for it is deliberately reticent by comparison -- a flat watermark cannot carry colour without
// looking like a mistake, and a photograph can.
import { useState } from 'react';

export function Headquarters({ className = '', tone = '#0B2942' }: { className?: string; tone?: string }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = `${import.meta.env.BASE_URL}ksp-hq.jpg`;

  if (!photoFailed) {
    return (
      <img
        src={photo}
        alt=""
        aria-hidden="true"
        onError={() => setPhotoFailed(true)}
        className={className}
        style={{
          objectFit: 'cover',
          // Anchored low so a wide panorama crops to the building and its steps rather than to
          // a band of sky.
          objectPosition: 'center 68%',
          // Colour, lifted slightly. A government building photographed at midday is high-key
          // already; a touch of saturation stops it going chalky against warm paper.
          filter: 'saturate(1.06) contrast(1.02)',
          // Masked at the top so the sky fades into the page instead of drawing a horizon
          // across it, and feathered at the sides so the panorama has no cut edges.
          // The mask does the real work here. At full strength this photograph swallowed the
          // stat block and the fairness line -- a login page where the copy is harder to read
          // than the wallpaper has its priorities backwards. It now stays transparent through
          // the upper half, where the text lives, and only reaches full weight near the floor
          // of the page where nothing is written.
          maskImage: 'linear-gradient(180deg, transparent 0%, transparent 22%, rgba(0,0,0,0.35) 48%, rgba(0,0,0,0.8) 74%, black 100%),'
            + ' linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, transparent 22%, rgba(0,0,0,0.35) 48%, rgba(0,0,0,0.8) 74%, black 100%),'
            + ' linear-gradient(90deg, transparent 0%, black 10%, black 90%, transparent 100%)',
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
          opacity: 0.78,
        }}
      />
    );
  }

  return (
    <svg viewBox="0 0 900 300" className={className} aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      <defs>
        {/* Fades the building into the page from the top down, so it never has a hard edge
            where the sky would be. */}
        <linearGradient id="hqFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.012" />
          <stop offset="45%" stopColor={tone} stopOpacity="0.055" />
          <stop offset="100%" stopColor={tone} stopOpacity="0.085" />
        </linearGradient>
      </defs>

      <g fill="url(#hqFade)">
        {/* Steps — the wide public approach every state building in Bengaluru has. */}
        <rect x="90" y="286" width="720" height="14" />
        <rect x="120" y="274" width="660" height="12" />
        <rect x="150" y="262" width="600" height="12" />

        {/* Podium */}
        <rect x="168" y="214" width="564" height="48" />

        {/* Colonnade. Drawn rather than repeated by hand so the rhythm is exact -- an arcade
            with uneven bays reads as a mistake at any size. */}
        {Array.from({ length: 17 }, (_, i) => {
          const x = 186 + i * 32.4;
          return (
            <g key={i}>
              <rect x={x} y="150" width="15" height="64" />
              {/* Capital and base, the two details that make a rectangle read as a column. */}
              <rect x={x - 2.5} y="146" width="20" height="6" />
              <rect x={x - 2.5} y="208" width="20" height="6" />
            </g>
          );
        })}
        {/* Entablature over the colonnade */}
        <rect x="168" y="132" width="564" height="16" />

        {/* Central pavilion, stepped back and taller — where the entrance is. */}
        <rect x="366" y="96" width="168" height="40" />
        <rect x="384" y="150" width="132" height="64" />
        {/* Three arched openings in the pavilion, cut back out of the mass. */}
        {[0, 1, 2].map((i) => {
          const cx = 414 + i * 36;
          return <path key={i} d={`M${cx - 13},214 L${cx - 13},176 A13,13 0 0,1 ${cx + 13},176 L${cx + 13},214 Z`} fill="#F6F3EB" fillOpacity="0.75" />;
        })}

        {/* Dome and lantern — the silhouette that says "state building" at a glance. */}
        <path d="M394,96 A56,50 0 0,1 506,96 Z" />
        <rect x="436" y="52" width="28" height="18" />
        <path d="M436,52 A14,13 0 0,1 464,52 Z" />
        {/* Finial */}
        <rect x="448" y="34" width="4" height="18" />
        <circle cx="450" cy="31" r="5" />

        {/* Flanking towers, so the composition has shoulders and does not taper away. */}
        <rect x="168" y="112" width="52" height="102" />
        <path d="M168,112 L194,84 L220,112 Z" />
        <rect x="680" y="112" width="52" height="102" />
        <path d="M680,112 L706,84 L732,112 Z" />
      </g>
    </svg>
  );
}
