"use client";

export function ThrowingModule(): never {
  throw new Error("Intentional foundation preview render failure");
}
