/** Browser decoding is bounded independently of the compressed PNG byte limit. */
export async function validateImagePixels(bytes: Uint8Array) {
  const stride = 1024 * (bytes[25] === 2 ? 3 : 4) + 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      for (let offset = 8; offset + 12 <= bytes.length; ) {
        const size = view.getUint32(offset);
        if (view.getUint32(offset + 4) === 0x49444154)
          controller.enqueue(
            new Uint8Array(bytes.subarray(offset + 8, offset + 8 + size)),
          );
        offset += size + 12;
      }
      controller.close();
    },
  });
  const reader = input
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  let offset = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      if (offset + result.value.length > stride * 1024) {
        await reader.cancel();
        throw new Error("Invalid image pixels");
      }
      for (
        let i = (stride - (offset % stride)) % stride;
        i < result.value.length;
        i += stride
      )
        if ((result.value[i] ?? 255) > 4) {
          await reader.cancel();
          throw new Error("Invalid PNG row filter");
        }
      offset += result.value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== stride * 1024) throw new Error("Invalid image pixels");
}
