// Minimal clsx-style class combiner — the project doesn't have clsx/tailwind-merge
// installed, so this covers what shadcn-style components need: strings, falsy
// values dropped, arrays/objects not required for anything currently in use.
export function cn(...args) {
  return args.filter(Boolean).join(' ')
}
