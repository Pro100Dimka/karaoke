import {
  CircleCheck,
  Headphones,
  Music2,
  Plus,
  Search,
  SlidersHorizontal,
  UsersRound
} from "lucide-react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { translateSaved as tr } from "../../../i18n/runtime";
import {
  Button,
  Card,
  IconButton,
  Popover,
  Select,
  Stack,
  TextField,
  Typography
} from "../../../theme/ui";
import { defaultLibraryFilters } from "../utils";

const SORTS = [
  ["relevance", "По умолчанию"],
  ["title", "Название"],
  ["artist", "Исполнитель"],
  ["recent", "Недавно добавленные"]
];
const options = (items, first) => [
  { value: "", label: tr(first) },
  ...items.map((item) => (typeof item === "object" ? item : { value: item, label: item }))
];

export default function LibraryActions({
  canManageLibrary,
  fileInputRef,
  filterOptions = { genres: [], keys: [] },
  filters = defaultLibraryFilters,
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
  useEffect(() => setDraft(filters), [filters]);

  const dropzone = useDropzone({
    accept: { "audio/*": [".mp3", ".wav", ".flac", ".m4a", ".ogg"] },
    disabled: importing || !canManageLibrary,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: onFileChosen
  });
  const update = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));
  const apply = () => {
    setFilters?.(draft);
    setOpen(false);
  };
  return (
    <Stack
      direction="row"
      gap="var(--space-4)"
      align="center"
      wrap
      sx={{ position: "relative", width: "50%" }}
      {...dropzone.getRootProps()}
      aria-label={tr("Зона добавления песен")}
      data-drop-active={dropzone.isDragActive || undefined}
    >
      <Card variant="laser" tilt={false} sx={{ containerType: "normal", flex: 1 }}>
        <TextField
          aria-label={tr("Поиск")}
          placeholder={tr("Поиск песен, исполнителей, жанров…")}
          value={query}
          size="lg"
          onChange={setQuery}
          startAdornment={<Search aria-hidden="true" />}
          endAdornment={
            <IconButton
              icon={SlidersHorizontal}
              variant={open ? "contained" : "outline"}
              label={tr("Фильтры и сортировка")}
              size="sm"
              sx={{ borderColor: "transparent", backgroundColor: "transparent", boxShadow: "none" }}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            />
          }
          sx={{ flex: 1 }}
        />
      </Card>
      <Stack direction="row" gap="var(--space-4)" sx={{ flex: 1 }}>
        {!roomActive && (
          <Button
            size="lg"
            variant="outlined"
            fullWidth
            startIcon={<UsersRound />}
            onClick={onOpenRoom}
          >
            {tr("Петь вместе")}
          </Button>
        )}
        {canManageLibrary && (
          <Button
            size="lg"
            variant="contained"
            startIcon={<Plus />}
            fullWidth
            disabled={importing}
            onClick={onAdd}
          >
            {tr("Добавить песню")}
          </Button>
        )}
        <input {...dropzone.getInputProps()} ref={fileInputRef} />
      </Stack>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        role="dialog"
        aria-label={tr("Фильтры и сортировка")}
        style={{
          insetBlockStart: "calc(100% + var(--space-3))",
          padding: "var(--space-6)",
          boxShadow: "var(--shadow-lg)"
        }}
      >
        <Stack gap="var(--space-5)">
          <Stack gap="var(--space-3)">
            <Typography variant="caption" tone="muted">
              {tr("Сортировка")}
            </Typography>
            <Stack direction="row" gap="var(--space-2)" wrap>
              {SORTS.map(([value, label]) => (
                <Button
                  key={value}
                  variant={draft.sort === value ? "contained" : "outlined"}
                  aria-pressed={draft.sort === value}
                  onClick={() => update("sort")(value)}
                >
                  {tr(label)}
                </Button>
              ))}
            </Stack>
          </Stack>

          <Stack gap="var(--space-3)">
            <Stack direction="row" align="center" justify="space-between">
              <Typography variant="caption" tone="muted">
                {tr("Фильтры")}
              </Typography>
              <Button variant="outlined" onClick={() => setDraft(defaultLibraryFilters)}>
                {tr("Сбросить всё")}
              </Button>
            </Stack>
            <Stack direction="row" gap="var(--space-3)" wrap>
              <Select
                label={tr("Жанр")}
                startIcon={<Headphones />}
                value={draft.genre}
                options={options(filterOptions.genres, "Все жанры")}
                onChange={update("genre")}
                fieldSx={{ flex: 1 }}
              />
              <Select
                label={tr("Тональность")}
                startIcon={<Music2 />}
                value={draft.key}
                options={options(filterOptions.keys, "Все тональности")}
                onChange={update("key")}
                fieldSx={{ flex: 1 }}
              />
              <Select
                label={tr("Статус")}
                startIcon={<CircleCheck />}
                value={draft.status}
                options={options(
                  [
                    { value: "done", label: tr("Готово") },
                    { value: "active", label: tr("Обрабатывается") },
                    { value: "error", label: tr("Ошибка") }
                  ],
                  "Все статусы"
                )}
                onChange={update("status")}
                fieldSx={{ flex: 1 }}
              />
            </Stack>
          </Stack>
          <Button variant="contained" fullWidth onClick={apply}>
            {tr("Применить")}
          </Button>
        </Stack>
      </Popover>
    </Stack>
  );
}
