"use server";

export const loadImage = async (src: string) => {
  const response = await fetch(src);
  return response.url;
};