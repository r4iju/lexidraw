// No DOM access here. We only do the tracing.
importScripts("/scripts/imagetracer_v1.2.6.js");

self.onmessage = function (e) {
  const { imgData, options } = e.data;
  const tracedata = ImageTracer.imagedataToTracedata(imgData, options);
  const tracedSvgString = ImageTracer.getsvgstring(tracedata);
  self.postMessage({ tracedSvgString });
};
