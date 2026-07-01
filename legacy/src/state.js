let awayMode = false

export function toggleAway() {
  awayMode = !awayMode
  return awayMode
}

export function isAway() {
  return awayMode
}
