"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/locale";
import { dataLayers } from "./si-data-layers";
import { layerEquations } from "./si-layer-equations";
import { SiLayerScene } from "./si-layer-scene";
import { siVideoUrl } from "./si-media";
import { rotationLayersHref as layersHref, SiStoryLink, useSiStoryTransition } from "./si-story-link";
import styles from "./si-model-guide.module.css";

const swipeThreshold = 48;
const swipeIdleMs = 200;

export function SiModelGuide({ showLayers = false, initialLayerIndex = 0 }: {
  showLayers?: boolean;
  initialLayerIndex?: number;
}) {
  const locale = useLocale();
  const isEnglish = locale === "en";
  const language = isEnglish ? "en" : "zh";
  const [activeIndex, setActiveIndex] = useState(initialLayerIndex);
  const guideRef = useRef<HTMLElement>(null);
  const active = dataLayers[activeIndex];
  const chapter = active[language];
  const backdrop = showLayers ? "rotation-layers" : "rotation-overview";
  const isTransitioning = useSiStoryTransition();

  useEffect(() => {
    const guide = guideRef.current;
    if (!showLayers || !guide) return;

    let lastWheelTime = -Infinity;
    let axis: "horizontal" | "vertical" | undefined;
    let distance = 0;
    let switched = false;

    function swipe(event: WheelEvent) {
      if (event.ctrlKey) return;

      const time = performance.now();
      if (time - lastWheelTime >= swipeIdleMs) {
        axis = undefined;
        distance = 0;
        switched = false;
      }
      lastWheelTime = time;

      const mode = event.deltaMode;
      const { deltaX, deltaY } = event;
      if (!axis && (deltaX || deltaY)) {
        axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.25 ? "horizontal" : "vertical";
      }
      if (axis !== "horizontal") return;

      event.preventDefault();
      if (switched) return;
      const unit = mode === WheelEvent.DOM_DELTA_LINE ? 16 : mode === WheelEvent.DOM_DELTA_PAGE ? window.innerWidth : 1;
      distance += deltaX * unit;
      if (Math.abs(distance) < swipeThreshold) return;

      switched = true;
      const direction = Math.sign(distance);
      setActiveIndex((index) => Math.max(0, Math.min(dataLayers.length - 1, index + direction)));
    }

    guide.addEventListener("wheel", swipe, { passive: false });
    return () => guide.removeEventListener("wheel", swipe);
  }, [showLayers]);

  return (
    <main ref={guideRef} className={`${styles.guide} ${showLayers ? styles.atlas : ""} locale-${language}`}>
      <div className={styles.backdrop} aria-hidden="true" data-si-story-media>
        <video
          src={isTransitioning || showLayers ? undefined : siVideoUrl(backdrop)}
          poster={`/images/si/${backdrop}-poster.webp`}
          autoPlay
          muted
          loop
          playsInline
        />
      </div>
      {showLayers ? (
        <section className={styles.layersPage} aria-labelledby="model-layers-title">
          <div className={styles.atlasMap}>
            <SiLayerScene key={active.id} layer={active.id} />
            <h1 id="model-layers-title">{chapter.title}</h1>
          </div>
          <aside className={styles.drawer}>
            <article key={active.id} className={styles.layerDetail} aria-labelledby="data-layer-title">
              <h2 className={styles.product} id="data-layer-title">{active.product}</h2>
              <dl>
                <dt>{isEnglish ? "What it measures" : "获取的观测"}</dt>
                <dd>{chapter.observes}</dd>
                <dt>{isEnglish ? "Model parameter estimates" : "对应建模参数估计"}</dt>
                <dd>{chapter.estimates}</dd>
                <dt>{isEnglish ? "Use and limitations" : "使用边界"}</dt>
                <dd>{chapter.boundary}</dd>
              </dl>
              <section className={styles.equations} aria-labelledby="layer-equations-title">
                <h3 id="layer-equations-title">{isEnglish ? "Model equations" : "模型公式"}</h3>
                {layerEquations[active.id].map((equation) => (
                  <div key={equation.expression} className={styles.equation}>
                    <p className={styles.equationExpression}>{equation.expression}</p>
                    <p>{equation[language]}</p>
                  </div>
                ))}
              </section>
            </article>
          </aside>
          <nav className={styles.layerNav} aria-label={isEnglish ? "Choose a data layer" : "选择数据图层"}>
            {dataLayers.map((layer, index) => (
              <button
                key={layer.id}
                type="button"
                aria-current={activeIndex === index ? "step" : undefined}
                onClick={() => setActiveIndex(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {layer[language].title}
              </button>
            ))}
          </nav>
          <p className="sr-only" role="status">{chapter.title} · {active.product}</p>
        </section>
      ) : (
        <section className={styles.overview} aria-labelledby="model-overview-title">
          <h1 className={styles.overviewTitle} id="model-overview-title">
            {isEnglish ? <>From orbit<br />to rotation</> : <>从卫星观测<br />到田间轮作</>}
          </h1>
          <ol className={styles.orbit} aria-label={isEnglish ? "Remote sensing layers" : "遥感数据层级"}>
            {dataLayers.map((layer, index) => (
              <li key={layer.id}>
                <SiStoryLink className={styles.orbitLink} href={`${layersHref}/${layer.id}`}>
                  <span>{index + 1}</span>
                  <strong>
                    {isEnglish
                      ? layer.en.title.split(" ").map((word, wordIndex) => (
                        <Fragment key={wordIndex}>{wordIndex > 0 ? " " : ""}<span className={styles.orbitWord}>{word}</span></Fragment>
                      ))
                      : layer.zh.title}
                  </strong>
                </SiStoryLink>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
