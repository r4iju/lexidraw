"use client";

import dynamic from "next/dynamic";

const ViewBoard = dynamic(() => import("./board-view"), {
  ssr: false,
});

export default ViewBoard;
