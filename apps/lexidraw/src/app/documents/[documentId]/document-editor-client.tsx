"use client";

import dynamic from "next/dynamic";

const DocumentEditor = dynamic(() => import("./document-editor"), {
  ssr: false,
});

export default DocumentEditor;
