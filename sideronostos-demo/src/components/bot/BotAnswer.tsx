"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";
import type { BotAnswerData, BotFact } from "@/lib/bot";
import styles from "./answer.module.css";

type Props = {
  answer: BotAnswerData;
  facts: BotFact[];
  animate: boolean;
  clientId: string;
  onComplete: (clientId: string, answer: string) => void;
  onProgress: () => void;
  onSource: (id: string) => void;
};

/** Only receives server-validated text. This is presentation, not provider token streaming. */
export function BotAnswer({
  answer,
  facts,
  animate,
  clientId,
  onComplete,
  onProgress,
  onSource,
}: Props) {
  const { t } = useI18n();

  const paragraphs = answer.paragraphs.map((p) => Array.from(p.text));
  const fullText = answer.paragraphs.map((p) => p.text).join("\n");
  const total = paragraphs.reduce((sum, p) => sum + p.length, 0);
  const [visible, setVisible] = useState(() =>
    !animate ||
    (typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches)
      ? total
      : 0,
  );
  const revealing = animate && visible < total;
  useEffect(() => {
    if (!revealing) {
      if (animate) onComplete(clientId, fullText);
      return;
    }
    const motion =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const revealAll = () => setVisible(total);
    const onMotion = (event: MediaQueryListEvent) => {
      if (event.matches) revealAll();
    };
    motion?.addEventListener("change", onMotion);
    const timer = window.setInterval(
      () => setVisible((count) => Math.min(total, count + 3)),
      30,
    );
    return () => {
      window.clearInterval(timer);
      motion?.removeEventListener("change", onMotion);
    };
  }, [animate, revealing, total, clientId, fullText, onComplete]);
  useEffect(() => {
    onProgress();
  }, [visible, onProgress]);
  const ids = [...new Set(answer.paragraphs.flatMap((p) => p.evidence_ids))];
  const available = revealing ? visible : total;
  return (
    <>
      <div aria-hidden={revealing || undefined}>
        {paragraphs.map((characters, index) => {
          const start = paragraphs
            .slice(0, index)
            .reduce((sum, p) => sum + p.length, 0);
          const count = Math.max(
            0,
            Math.min(characters.length, available - start),
          );
          return count > 0 ? (
            <p className={styles.answerText} key={index}>
              {characters.slice(0, count).join("")}
              {revealing && start + count === visible && (
                <span className={styles.replyCursor} aria-hidden="true" />
              )}
            </p>
          ) : null;
        })}
      </div>
      {revealing ? (
        <button
          className={styles.revealAll}
          type="button"
          onClick={() => setVisible(total)}
        >
          {t("显示完整回答")}</button>
      ) : (
        (ids.length > 0 || facts.length > 0) && (
          <details className={styles.evidenceDisclosure}>
            <summary>{t("依据与数据")}</summary>
            {ids.length > 0 && (
              <div className={styles.citations}>
                {ids.map((id, index) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={t("查看依据 {0}", { "0": id })}
                    onClick={() => onSource(id)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            )}
            {facts.length > 0 && (
              <details className={styles.facts}>
                <summary>{t("查看当时的数据 · ")}{facts.length} {t(" 项")}</summary>
                <dl>
                  {facts.map((fact) => (
                    <div key={fact.id}>
                      <dt>{t(fact.label)}</dt>
                      <dd>{fact.display}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </details>
        )
      )}
    </>
  );
}
