import Image from "next/image";
import { siVideoUrl } from "./si-media";

export function SiOrbitBackground({ storyMedia = false }: { storyMedia?: boolean }) {
  return (
    <div className="si-hero-background" aria-hidden="true" data-si-story-media={storyMedia ? "" : undefined}>
      <div className="si-hero-scene">
        <div className="si-hero-beam">
          <video
            src={siVideoUrl("field-harvest-original")}
            poster="/images/si/field-harvest-original-poster.webp"
            autoPlay
            muted
            loop
            playsInline
          />
        </div>
        <Image
          src="/images/si/orbit-annotated-cutout.webp"
          alt=""
          fill
          unoptimized
          fetchPriority="high"
        />
      </div>
    </div>
  );
}
