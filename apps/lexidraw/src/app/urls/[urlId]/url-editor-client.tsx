"use client";

import dynamic from "next/dynamic";

const UrlEditor = dynamic(() => import("./url-editor"), {
  ssr: false,
});

export default UrlEditor;
