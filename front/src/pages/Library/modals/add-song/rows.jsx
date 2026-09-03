import { AIModes } from "../../../../constants/utils";
import { translateSaved as tr } from "../../../../i18n/runtime";
import SelectedFilePreview from "./select-file-preview";

export default (item) =>
  [
    ...(item
      ? [
          { tag: "artist", label: tr("library.sort.artist"), required: true, md: 6 },
          { tag: "title", label: tr("library.songTitle"), required: true, md: 6 },
          {
            tag: "processingMode",
            type: "SelectField",
            label: tr("library.processingMode"),
            options: AIModes,
            md: 11
          },
          {
            tag: "preview",
            type: "custom",
            md: 1,
            render: () => <SelectedFilePreview file={item.file} />
          }
        ]
      : [])
  ].map((row) => ({ ...row, size: "lg" }));
