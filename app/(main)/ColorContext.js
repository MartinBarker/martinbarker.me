"use client";
import { createContext, useContext } from "react";

export const ColorContext = createContext(null);

export function useColorContext() {
  return useContext(ColorContext);
}
