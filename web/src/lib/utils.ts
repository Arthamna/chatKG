import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** id-ID number format: 1.284 · 1,2 */
export const fmt = (n: number, digits = 0) =>
  n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })
