let awayMode = false
let hostNumber = ''

export function init(host) {
  hostNumber = host
  awayMode = false
}

export function toggleAway() {
  awayMode = !awayMode
  return awayMode
}

export function isAway() {
  return awayMode
}

export function isHost(sender) {
  return sender === hostNumber
}
