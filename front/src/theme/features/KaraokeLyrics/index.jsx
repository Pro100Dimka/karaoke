import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translateSaved as t } from "../../../i18n/runtime";
import Box from "../../ui/Box";
import Stack from "../../ui/Stack";
import Typography from "../../ui/Typography";
import { buildLyricLines, lyricLineIndex, lyricSyllableFill, lyricWordFill } from "./timeline";

function KaraokeLyrics({ lyricsSync, currentTime = 0, currentTimeRef, isPlaying = false }) {
  const lines = useMemo(() => buildLyricLines(lyricsSync), [lyricsSync]);
  const [first, setFirst] = useState(() => lyricLineIndex(lines, Number(currentTime) || 0));
  const wordRefs = useRef(new Map());
  const syllableRefs = useRef(new Map());
  const update = useCallback(
    (time) => {
      const next = lyricLineIndex(lines, time);
      setFirst((value) => (value === next ? value : next));
      wordRefs.current.forEach((node, key) => {
        const [lineIndex, wordIndex] = key.split(":").map(Number);
        const word = lines[lineIndex]?.[wordIndex];
        if (word) node.style.setProperty("--character-fill", lyricWordFill(word, time));
      });
      syllableRefs.current.forEach((node, key) => {
        const [lineIndex, wordIndex, syllableIndex] = key.split(":").map(Number);
        const syllable = lines[lineIndex]?.[wordIndex]?.syllables?.[syllableIndex];
        if (syllable) node.style.setProperty("--character-fill", lyricSyllableFill(syllable, time));
      });
    },
    [lines]
  );

  useLayoutEffect(
    () => update(Number(currentTimeRef?.current ?? currentTime) || 0),
    [currentTime, currentTimeRef, update]
  );
  useEffect(() => {
    if (!isPlaying || !currentTimeRef) return undefined;
    let frame;
    const render = () => {
      update(Number(currentTimeRef.current) || 0);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [currentTimeRef, isPlaying, update]);

  if (!lines.length)
    return <Typography tone="muted">{t("common.syncedTextNotAvailable")}</Typography>;
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
      {lines.slice(first, first + 2).map((words, lineOffset) => {
        const lineIndex = first + lineOffset;
        return (
          <Typography
            key={lineIndex}
            as="p"
            data-role="lyric-line"
            data-current={!lineOffset || undefined}
            variant={lineOffset ? "h3" : "h2"}
            align="center"
            sx={{
              inlineSize: "100%",
              maxInlineSize: "100%",
              overflow: lineOffset ? "visible" : "hidden",
              whiteSpace: "nowrap",
              color: lineOffset ? "var(--color-text-muted)" : "var(--color-text)",
              fontWeight: lineOffset ? 680 : 820,
              letterSpacing: "-0.018em",
              lineHeight: 1.05,
              textShadow:
                "0 .08em .12em color-mix(in srgb, var(--color-bg-deep) 78%, transparent), 0 .24em .65em color-mix(in srgb, var(--color-bg-deep) 44%, transparent)"
            }}
          >
            {words.map((word, wordIndex) => {
              const syllables =
                Array.isArray(word.syllables) &&
                word.syllables.length > 1 &&
                word.syllables.map(({ text }) => text).join("") === word.text
                  ? word.syllables
                  : null;
              return (
                <Box
                  as="span"
                  key={`${word.index}-${wordIndex}`}
                  ref={(node) => {
                    const key = `${lineIndex}:${wordIndex}`;
                    if (node) wordRefs.current.set(key, node);
                    else wordRefs.current.delete(key);
                  }}
                  data-role="lyric-word"
                  data-text={word.text}
                  data-start={word.start}
                  data-end={word.end}
                  style={{
                    "--character-fill": lyricWordFill(
                      word,
                      Number(currentTimeRef?.current ?? currentTime) || 0
                    )
                  }}
                  sx={{
                    marginInlineEnd: "var(--space-2)",
                    position: "relative",
                    display: "inline-block",
                    color: lineOffset ? "var(--color-text-muted)" : "var(--color-text)",
                    WebkitTextFillColor: lineOffset
                      ? "var(--color-text-muted)"
                      : "var(--color-text)"
                  }}
                >
                  {syllables ? (
                    syllables.map((syllable, syllableIndex) => (
                      <Box
                        as="span"
                        key={`${syllable.start}-${syllableIndex}`}
                        ref={(node) => {
                          const key = `${lineIndex}:${wordIndex}:${syllableIndex}`;
                          if (node) syllableRefs.current.set(key, node);
                          else syllableRefs.current.delete(key);
                        }}
                        data-role="lyric-syllable"
                        data-text={syllable.text}
                        data-start={syllable.start}
                        data-end={syllable.end}
                        style={{
                          "--character-fill": lyricSyllableFill(
                            syllable,
                            Number(currentTimeRef?.current ?? currentTime) || 0
                          )
                        }}
                        sx={{ position: "relative", display: "inline-block" }}
                      >
                        {syllable.text}
                        <Box
                          as="span"
                          aria-hidden="true"
                          data-role="lyric-syllable-fill"
                          sx={{
                            position: "absolute",
                            inset: 0,
                            color: "var(--color-primary-hover)",
                            WebkitTextFillColor: "var(--color-primary-hover)",
                            clipPath: "inset(0 calc(100% - var(--character-fill)) 0 0)",
                            pointerEvents: "none",
                            willChange: "clip-path"
                          }}
                        >
                          {syllable.text}
                        </Box>
                      </Box>
                    ))
                  ) : (
                    <>
                      {word.text}
                      <Box
                        as="span"
                        aria-hidden="true"
                        data-role="lyric-word-fill"
                        sx={{
                          position: "absolute",
                          inset: 0,
                          color: "var(--color-primary-hover)",
                          WebkitTextFillColor: "var(--color-primary-hover)",
                          clipPath: "inset(0 calc(100% - var(--character-fill)) 0 0)",
                          pointerEvents: "none",
                          willChange: "clip-path"
                        }}
                      >
                        {word.text}
                      </Box>
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

export default memo(KaraokeLyrics, (previous, next) => {
  if (
    previous.lyricsSync !== next.lyricsSync ||
    previous.currentTimeRef !== next.currentTimeRef ||
    previous.isPlaying !== next.isPlaying
  )
    return false;
  return (
    Boolean(next.isPlaying && next.currentTimeRef) || previous.currentTime === next.currentTime
  );
});
