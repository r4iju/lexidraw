"use client";

import dynamic from "next/dynamic";
import { Canvas } from "./drawing-loading";

const ViewBoard = dynamic(() => import("./board-view"), {
  ssr: false,
  loading: Canvas,
});

export default ViewBoard;
