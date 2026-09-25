/**
 * Stands in for `pica` and `image-blob-reduce`, which the editor loads only to
 * shrink an image someone drops onto a drawing; a conversion never does.
 * pica is a browserify bundle whose loader calls `require` with a name no
 * bundler can follow, which Turbopack warns about on every compile.
 */
const unavailable = () => {
  throw new Error("Resizing an image needs a browser");
};

export default unavailable;
