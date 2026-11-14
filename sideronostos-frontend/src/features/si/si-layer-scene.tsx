import Image from "next/image";
import type { dataLayers } from "./si-data-layers";
import styles from "./si-layer-scene.module.css";

type LayerId = (typeof dataLayers)[number]["id"];

const layerSceneVideo = {
  weather: "rotation-weather",
  rain: "rotation-precipitation",
  thermal: "rotation-layers",
  vegetation: "rotation-vegetation",
  terrain: "rotation-terrain",
  storage: "rotation-storage",
} satisfies Record<LayerId, string>;

export function SiLayerScene({ layer }: { layer: LayerId }) {
  const video = layerSceneVideo[layer];
  const poster = `/images/si/${video}-poster.webp`;

  return (
    <div className={styles.scene} data-layer={layer} aria-hidden="true">
      <div className={styles.landscape}>
        <Image className={styles.landscapePoster} src={poster} alt="" fill sizes="(max-width: 760px) 100vw, 65vw" />
        <video
          className={styles.landscapeVideo}
          src={`/videos/si/${video}.mp4`}
          poster={poster}
          preload="auto" autoPlay muted loop playsInline
        />
      </div>
      <div className={styles.atmosphere} />
    </div>
  );
}
