import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Box, Stack, Typography } from "../../../../theme/ui";
import { buildLyricLines, lyricLineIndex, lyricSyllableFill, lyricWordFill } from "./timeline";

const fillSx = {
  position: "absolute",
  inset: 0,
  color: "var(--color-primary-hover)",
  WebkitTextFillColor: "var(--color-primary-hover)",
  clipPath: "inset(0 calc(100% - var(--character-fill)) 0 0)",
  pointerEvents: "none",
  willChange: "clip-path"
};

const Fill = ({ children, dataRole }) => (
  <Box as="span" aria-hidden data-role={dataRole} sx={fillSx}>
    {children}
  </Box>
);

function KaraokeLyrics({ lyricsSync, currentTime = 0, currentTimeRef, isPlaying = false }) {
  const lines = useMemo(() => buildLyricLines(lyricsSync), [lyricsSync]);
  const time = Number(currentTimeRef?.current ?? currentTime) || 0;
  const [first, setFirst] = useState(() => lyricLineIndex(lines, time));
  const refs = useRef(new Map());

  const bind = (key, item, fill) => (node) => {
    if (node) refs.current.set(key, [node, item, fill]);
    else refs.current.delete(key);
  };

  const update = useCallback(
    (time) => {
      const next = lyricLineIndex(lines, time);
      setFirst((first) => (first === next ? first : next));

      refs.current.forEach(([node, item, fill]) => {
        node.style.setProperty("--character-fill", fill(item, time));
      });
    },
    [lines]
  );

  useLayoutEffect(() => update(time), [time, update]);

  useEffect(() => {
    if (!isPlaying || !currentTimeRef) return;

    let frame;

    const render = () => {
      update(Number(currentTimeRef.current) || 0);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [currentTimeRef, isPlaying, update]);

  if (!lines.length) {
    return <Typography tone="muted">{t("common.syncedTextNotAvailable")}</Typography>;
  }

  return (
    <Stack
      data-role="lyrics"
      align="center"
      gap="var(--space-3)"
      sx={{
        position: "absolute",
        inset: "35% 50% auto auto",
        transform: "translateX(50%)",
        inlineSize: "min(86rem, 90vw)",
        maxInlineSize: "90vw",
        padding: "var(--space-3) var(--space-6)",
        border: "1px solid color-mix(in srgb, var(--color-text) 12%, transparent)",
        borderRadius: "var(--shape-xl)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-bg-deep) 30%, transparent), color-mix(in srgb, var(--color-bg-deep) 17%, transparent))",
        boxShadow:
          "0 var(--space-3) var(--space-8) color-mix(in srgb, var(--color-bg-deep) 24%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-text) 8%, transparent)",
        backdropFilter: "blur(var(--space-3)) saturate(1.12)",
        zIndex: 4,
        pointerEvents: "none",
        overflow: "hidden"
      }}
    >
      {lines.slice(first, first + 2).map((words, offset) => {
        const line = first + offset;
        const next = !!offset;

        return (
          <Typography
            key={line}
            as="p"
            data-role="lyric-line"
            data-current={!next || undefined}
            variant={next ? "h3" : "h2"}
            align="center"
            sx={{
              inlineSize: "100%",
              overflow: next ? "visible" : "hidden",
              whiteSpace: "nowrap",
              color: next ? "var(--color-text-muted)" : "var(--color-text)",
              fontWeight: next ? 680 : 820,
              letterSpacing: "-0.018em",
              lineHeight: 1.05,
              textShadow:
                "0 .08em .12em color-mix(in srgb, var(--color-bg-deep) 78%, transparent), 0 .24em .65em color-mix(in srgb, var(--color-bg-deep) 44%, transparent)"
            }}
          >
            {words.map((word, wordIndex) => {
              const syllables =
                word.syllables?.length > 1 &&
                word.syllables.map(({ text }) => text).join("") === word.text
                  ? word.syllables
                  : null;

              return (
                <Box
                  as="span"
                  key={`${word.index}-${wordIndex}`}
                  ref={bind(`${line}:${wordIndex}`, word, lyricWordFill)}
                  data-role="lyric-word"
                  data-text={word.text}
                  data-start={word.start}
                  data-end={word.end}
                  style={{ "--character-fill": lyricWordFill(word, time) }}
                  sx={{
                    position: "relative",
                    display: "inline-block",
                    marginInlineEnd: "var(--space-2)",
                    color: next ? "var(--color-text-muted)" : "var(--color-text)",
                    WebkitTextFillColor: next ? "var(--color-text-muted)" : "var(--color-text)"
                  }}
                >
                  {syllables ? (
                    syllables.map((syllable, syllableIndex) => (
                      <Box
                        as="span"
                        key={`${syllable.start}-${syllableIndex}`}
                        ref={bind(
                          `${line}:${wordIndex}:${syllableIndex}`,
                          syllable,
                          lyricSyllableFill
                        )}
                        data-role="lyric-syllable"
                        data-text={syllable.text}
                        data-start={syllable.start}
                        data-end={syllable.end}
                        style={{
                          "--character-fill": lyricSyllableFill(syllable, time)
                        }}
                        sx={{ position: "relative", display: "inline-block" }}
                      >
                        {syllable.text}
                        <Fill>{syllable.text}</Fill>
                      </Box>
                    ))
                  ) : (
                    <>
                      {word.text}
                      <Fill>{word.text}</Fill>
                    </>
                  )}
                </Box>
              );
            })}
          </Typography>
        );
      })}
    </Stack>
  );
}

export default memo(
  KaraokeLyrics,
  (prev, next) =>
    prev.lyricsSync === next.lyricsSync &&
    prev.currentTimeRef === next.currentTimeRef &&
    prev.isPlaying === next.isPlaying &&
    (!!(next.isPlaying && next.currentTimeRef) || prev.currentTime === next.currentTime)
);
