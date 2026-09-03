import { Music2 } from "lucide-react";
import { translateSaved as tr } from "../../../../i18n/runtime";
import { Box, Button, Modal, RenderFormikFields, useGetForm } from "../../../../theme/ui";
import getRows from "./rows";

export default function AddSongsModal({ review, onCancel, onConfirm }) {
  const item = review?.items?.[review.index];
  const form = useGetForm({
    initialValues: {
      artist: item?.artist || "",
      title: item?.title || "",
      processingMode: item?.processingMode || ""
    },
    onSubmit: (values) => values.title.trim() && onConfirm(values)
  });
  const fields = getRows({ ...form.values, ...item });
  return (
    <Modal
      isOpen={!!item}
      onClose={onCancel}
      ariaLabel={tr("library.confirmAddingSong")}
      titleProps={{
        icon: Music2,
        image: item?.coverUrl,
        eyebrow: item ? tr("library.songOf", { 0: review.index + 1, 1: review.items.length }) : "",
        title: tr("library.checkSongDetails"),
        description: tr("library.processingStartsOnlyAfterAllFilesAreConfirmed"),
        actions: item && (
          <>
            <Button variant="outlined" onClick={onCancel}>
              {tr("library.skip")}
            </Button>
            <Button
              variant="contained"
              disabled={!form.values.title.trim() || form.isSubmitting}
              onClick={form.submitForm}
            >
              {tr("common.confirm")}
            </Button>
          </>
        )
      }}
    >
      {item && (
        <Box as="form" onSubmit={form.handleSubmit} sx={{ padding: "var(--space-5)" }}>
          <RenderFormikFields formik={form} items={fields} />
        </Box>
      )}
    </Modal>
  );
}
