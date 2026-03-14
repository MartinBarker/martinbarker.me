"use client";
import { createContext, useContext } from "react";

export const ColorContext = createContext({
  colors: null,
  colorData: null,
  darkMode: false,
  setDarkMode: () => {},
});

export function useColorContext() {
  return useContext(ColorContext);
}
