import { Music2 } from "lucide-react";
import useSongCover from "../../hooks/useSongCover";

/**
 * Cover-art tile shared by the library song card and the processing modal:
 * shows the picture extracted from the song's audio file, falling back to a
 * note icon while nothing has been extracted yet or the image fails to load.
 * `children` renders on top of the art (e.g. the song card's reactive wave).
 */
export default function SongCoverArt({ children, className, iconSize = 26, song }) {
  const { coverUrl, hasCover, handleCoverError } = useSongCover(song?.id, song?.__roomLocal);
  return (
    <div className={className} aria-hidden="true">
      {hasCover ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={handleCoverError}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            inset: 0
          }}
        />
      ) : (
        <Music2 size={iconSize} />
      )}
      {children}
    </div>
  );
}
