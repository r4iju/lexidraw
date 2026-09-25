"use client";

import dynamic from "next/dynamic";
import { Canvas } from "./drawing-loading";

const EditBoard = dynamic(() => import("./board-edit"), {
  ssr: false,
  loading: Canvas,
});

export default EditBoard;
