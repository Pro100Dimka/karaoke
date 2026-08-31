import {
  CircleCheck,
  Headphones,
  Music2,
  Plus,
  Search,
  SlidersHorizontal,
  UsersRound
} from "lucide-react";
import { useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { translateSaved as tr } from "../../../i18n/runtime";
import {
  Button,
  IconButton,
  Popover,
  Select,
  Stack,
  TextField,
  Typography
} from "../../../theme/ui";
import { defaultLibraryFilters as defaults } from "../utils";

const sorts = [
  ["relevance", "library.sort.relevance"],
  ["title", "library.sort.title"],
  ["artist", "library.sort.artist"],
  ["recent", "library.sort.recent"]
];

const opts = (all, items = []) => [
  { value: "", label: tr(all) },
  ...items.map((x) => (typeof x === "object" ? x : { value: x, label: x }))
];

export default function LibraryActions({
  canManageLibrary: can,
  fileInputRef,
  filterOptions: o = {},
  filters = defaults,
  importing,
  onAdd,
  onFileChosen,
  onOpenRoom,
  roomActive,
  query,
  setFilters,
  setQuery
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const anchor = useRef();

  const drop = useDropzone({
    accept: {
      "audio/*": [".mp3", ".wav", ".flac", ".m4a", ".ogg"],
      "application/octet-stream": [".kar", ".mid", ".kfn"]
    },
    disabled: importing || !can,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: onFileChosen
  });

  const set = (key, value) => setDraft((x) => ({ ...x, [key]: value }));

  const fields = [
    ["genre", "library.genre", Headphones, o.genres, "library.allGenres"],
    ["key", "karaoke.key", Music2, o.keys, "library.allKeys"],
    [
      "status",
      "settings.history.status",
      CircleCheck,
      [
        ["done", "status.done"],
        ["active", "status.processing"],
        ["error", "status.error"]
      ].map(([value, label]) => ({ value, label: tr(label) })),
      "library.allStatuses"
    ]
  ];

  const buttons = [
    [!roomActive, UsersRound, "library.singAlong", "outlined", onOpenRoom],
    [can, Plus, "library.addASong", undefined, onAdd, importing]
  ];

  return (
    <Stack
      {...drop.getRootProps()}
      direction="row"
      gap="var(--space-4)"
      align="center"
      sx={{ width: "50%" }}
    >
      <TextField
        fullWidth
        size="lg"
        value={query}
        onChange={setQuery}
        placeholder={tr("library.searchSongsArtistsGenres")}
        aria-label={tr("common.search")}
        startAdornment={<Search />}
        endAdornment={
          <IconButton
            ref={anchor}
            icon={SlidersHorizontal}
            size="sm"
            label={tr("library.filtersAndSorting")}
            variant={open ? "contained" : "outline"}
            onClick={() => {
              !open && setDraft(filters);
              setOpen(!open);
            }}
          />
        }
      />

      {buttons
        .filter(([show]) => show)
        .map(([, Icon, label, variant, onClick, disabled]) => (
          <Button
            key={label}
            size="lg"
            variant={variant}
            startIcon={<Icon />}
            disabled={disabled}
            onClick={onClick}
            sx={{ textWrap: "nowrap", padding: "0 var(--space-8)" }}
          >
            {tr(label)}
          </Button>
        ))}

      <input {...drop.getInputProps()} ref={fileInputRef} />

      <Popover open={open} anchorRef={anchor} placement="bottom-end" onClose={() => setOpen(false)}>
        <Stack gap="var(--space-4)">
          <Typography tone="muted">{tr("library.sorting")}</Typography>

          <Stack direction="row" gap="var(--space-2)" wrap>
            {sorts.map(([value, label]) => (
              <Button
                key={value}
                variant={draft.sort === value ? "contained" : "outlined"}
                onClick={() => set("sort", value)}
              >
                {tr(label)}
              </Button>
            ))}
          </Stack>

          <Stack direction="row" gap="var(--space-3)" wrap>
            {fields.map(([key, label, Icon, items, all]) => (
              <Select
                key={key}
                label={tr(label)}
                startIcon={<Icon />}
                value={draft[key]}
                options={opts(all, items)}
                onChange={(value) => set(key, value)}
              />
            ))}
          </Stack>

          <Stack direction="row" gap="var(--space-2)">
            {[
              ["library.apply", undefined, () => (setFilters?.(draft), setOpen(false))],
              ["library.reset", "outlined", () => setDraft(defaults)]
            ].map(([label, variant, onClick]) => (
              <Button key={label} fullWidth variant={variant} onClick={onClick}>
                {tr(label)}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Popover>
    </Stack>
  );
}
