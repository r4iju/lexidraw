import { Fredoka, Ubuntu_Mono } from "next/font/google";

export const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
  display: "block",
});
export const mono = Ubuntu_Mono({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-ubuntu-mono",
  preload: false,
  display: "block",
});

export const fontVariables = `${fredoka.variable} ${mono.variable}`;
