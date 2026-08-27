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

// Top-down fade. Values are alphas, not stops of a colour: `transparent` hides the photograph
// entirely, `black` shows it at full strength, and everything between is partial. Read it as a
// list of "how much building is allowed at this height of the page".
const HQ_FADE = 'linear-gradient(180deg,'
  + ' transparent 0%,'            // the wordmark's air
  + ' rgba(0,0,0,0.03) 22%,'      // sky: a rumour of a roofline, no more
  + ' rgba(0,0,0,0.07) 42%,'      // behind the strapline
  + ' rgba(0,0,0,0.14) 60%,'      // behind the stat block -- deliberately almost nothing
  + ' rgba(0,0,0,0.32) 75%,'      // below the last line of copy, the facade can arrive
  + ' rgba(0,0,0,0.62) 88%,'
  + ' rgba(0,0,0,0.9) 100%)';     // forecourt and lawn, held back a little: bright green at
                                  // full weight is the loudest thing on a page of ivory

// Side feather, so a full-width photograph has no cut edges against the window frame.
const HQ_FEATHER = 'linear-gradient(90deg, transparent 0%, black 6%, black 94%, transparent 100%)';

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
          // Near-centred. The container is now the full viewport, whose aspect ratio is close
          // enough to the photograph's own that cover crops almost nothing -- so there is no
          // band to choose any more, and anchoring low would only shave the roofline.
          objectPosition: 'center 55%',
          // Colour, lifted slightly. A government building photographed at midday is high-key
          // already; a touch of saturation stops it going chalky against warm paper.
          filter: 'saturate(1.06) contrast(1.02)',
          // THE MASK IS THE WHOLE DESIGN.
          //
          // The photograph now runs the full height of the page rather than sitting in a band
          // at the floor, so it passes behind every word on the screen. What keeps it a
          // backdrop instead of a wall is this ramp: a ghost at the top where the wordmark is,
          // barely there through the middle where the copy runs, and only arriving at full
          // weight in the bottom fifth where nothing is written. Extending the image without
          // extending the fade would just be the earlier mistake at a larger size.
          //
          // The second gradient feathers the left and right edges so a full-bleed photograph
          // does not butt against the window frame with a cut edge. maskComposite multiplies
          // the two, which keeps each of them a readable one-dimensional ramp.
          maskImage: `${HQ_FADE}, ${HQ_FEATHER}`,
          WebkitMaskImage: `${HQ_FADE}, ${HQ_FEATHER}`,
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
          opacity: 0.72,
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
