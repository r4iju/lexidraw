"use client";

import { MainMenu } from "@excalidraw/excalidraw";

type MainMenuProps = typeof MainMenu extends React.FC<infer P> ? P : never;

const MainMenuWrapper: React.FC<MainMenuProps> = (props: MainMenuProps) => {
  return <MainMenu {...props}>{props.children}</MainMenu>;
};

export default MainMenuWrapper;
