"use client";

import dynamic from "next/dynamic";

const EditBoard = dynamic(() => import("./board-edit"), {
  ssr: false,
});

export default EditBoard;
