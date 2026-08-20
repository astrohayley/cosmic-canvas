# Cosmic Canvas TODO

## Product work

- Replace client-side brightness-threshold mask generation with masks supplied through subject image metadata.
  - [ ] Extract the RLE string from subject metadata when a subject loads. The data-delivery system does not provide this field yet, and its metadata key/schema is not known.
  - Parse the metadata payload into a binary pixel mask that the browser application can display and edit, using the project's established protocol:
    - The RLE value is a whitespace-delimited string of alternating `start length` integer pairs.
    - Starts use one-based indexing and must be converted to zero-based offsets before decoding.
    - Each pair marks the half-open foreground range `[start - 1, start - 1 + length)` in a flat binary array initialized to zero.
    - Reshape the flat array to `(height, width)` in row-major/C order, matching NumPy's default `reshape(shape)` behavior.
    - Foreground pixels are `1`; background pixels are `0`.
  - [x] Implement and test the standalone RLE decoder/encoder in `src/utils/rleMask.mjs`, including a round trip of the supplied example mask.
  - Define and document the subject metadata key containing the RLE string.
  - Obtain the mask shape from the input image's intrinsic dimensions: `(image.naturalHeight, image.naturalWidth)`. Subjects are expected to use consistently sized images, but derive and validate dimensions for each subject rather than hard-coding a global shape.
  - For subjects with multiple images sharing one overlay, verify that all relevant images have the same intrinsic dimensions; surface a clear error if they do not.
  - Validate mask dimensions and malformed or missing RLE data, with a clear fallback/error state.
    - Reject or handle odd token counts, non-integer or negative values, invalid one-based starts, zero/negative lengths, unsorted or overlapping runs, and ranges beyond `height * width`.
    - Treat a non-string RLE consistently with the reference Python protocol, which returns an all-background mask, unless stricter validation is chosen.
  - Convert the decoded binary mask into the editable representation used by `BrushTool` without changing its alignment with the displayed subject images.
  - Preserve one shared annotation overlay when users switch among a subject's images.
  - Decide on behavior when mask metadata is absent or invalid.
- [x] Flatten brush annotations into a real-time binary mask instead of accumulating translucent canvas strokes.
  - [x] Treat every mask pixel as either foreground or background; overlapping brush passes never increase opacity or produce darker regions.
  - [x] Make brush operations set foreground pixels and eraser operations clear them in real time.
  - [x] Keep the displayed mask color and opacity uniform across all foreground pixels.
  - [x] Preserve undo, clear, reset-to-initial-mask, brush-size, shared-overlay image switching, and submission behavior.
  - [x] Submit the final edited mask as the same one-based `start length` RLE string instead of `react-canvas-draw` save data.
  - [ ] Verify the complete metadata-RLE → edits → submitted-RLE round trip once subject metadata delivery is implemented.
- Fetch another batch from the Panoptes subject queue when the current batch is exhausted instead of cycling back to the first loaded subject.
  - Avoid presenting subjects already classified or skipped during the session when possible.
  - Add loading, empty-queue, and fetch-error states.

## Repository maintenance (separate from product changes)

- Add an ESLint configuration compatible with the existing `npm run lint` script and current React source.
- Fix the production build failure caused by top-level `await` in `src/configLoader.js` under Vite's configured browser target.
- Expand automated coverage beyond the initial RLE codec tests.

## Decisions to preserve

- Multiple images belonging to one subject share a single annotation overlay.
- Anonymous production classifications are allowed.
- Classifications are submitted to the Zooniverse Panoptes backend with the edited binary mask encoded as a one-based `start length` RLE string.
- The mask-editing task is always present as `T0` in the default loaded workflow. Hard-coding `T0` in classification submissions is intentional.
