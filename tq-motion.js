/* TeleportHQ motion runtime: scroll scenes, element motion and scroll video for this static site. */

window.__tqMotionRuntime = true

;(function () {
const scrollProgressForOffset = (rect, viewportHeight, offset) => {
  const vh = viewportHeight || 1
  let raw
  if (offset === 'contained') {
    const travel = rect.height - vh
    raw = travel > 0 ? -rect.top / travel : (vh - rect.top) / (vh + rect.height)
  } else if (offset === 'enter') {
    raw = (vh - rect.top) / vh
  } else if (offset === 'exit') {
    raw = (vh - rect.bottom) / vh
  } else {
    raw = (vh - rect.top) / (vh + rect.height)
  }
  return Math.min(1, Math.max(0, raw))
}

const followProgress = (measure, smoothingSeconds, apply) => {
  let current = measure()
  let frame = 0
  let lastTs = 0
  const tick = (ts) => {
    frame = 0
    const target = measure()
    if (smoothingSeconds > 0) {
      const dt = lastTs ? (ts - lastTs) / 1000 : 1 / 60
      lastTs = ts
      const alpha = 1 - Math.exp(-dt / Math.max(0.05, smoothingSeconds / 3))
      const next = current + (target - current) * alpha
      current = Math.abs(target - next) < 0.0005 ? target : next
    } else {
      current = target
    }
    apply(current)
    if (current !== target) {
      frame = window.requestAnimationFrame(tick)
    } else {
      lastTs = 0
    }
  }
  const schedule = () => {
    if (!frame) {
      frame = window.requestAnimationFrame(tick)
    }
  }
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  return { get: () => current }
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const whenParsed = (boot) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
}

const EASINGS = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
  spring: [0.34, 1.56, 0.64, 1],
  back: [0.68, -0.6, 0.32, 1.6],
  bounce: [0.22, 1.2, 0.36, 1],
}

const TRANSFORM_KEYS = ['x', 'y', 'scale', 'rotate']

const withUnit = (value, unit) => (typeof value === 'number' ? value + unit : String(value))

const writeTransformProps = (css, state) => {
  if (state.x !== undefined || state.y !== undefined) {
    css.translate =
      withUnit(state.x !== undefined ? state.x : 0, 'px') +
      ' ' +
      withUnit(state.y !== undefined ? state.y : 0, 'px')
  }
  if (state.scale !== undefined) {
    css.scale = String(state.scale)
  }
  if (state.rotate !== undefined) {
    css.rotate = withUnit(state.rotate, 'deg')
  }
}

const FILTER_LIST_RE = /^(?:[a-z-]+\(\s*-?\d*\.?\d+(?:px|deg|%)?\s*\)\s*)+$/
const FILTER_FN_RE = /([a-z-]+)\(\s*(-?\d*\.?\d+)(px|deg|%)?\s*\)/g

const interpolateFilter = (from, to, p) => {
  if (!FILTER_LIST_RE.test(from.trim()) || !FILTER_LIST_RE.test(to.trim())) {
    return null
  }
  const fromFns = Array.from(from.matchAll(FILTER_FN_RE))
  const toFns = Array.from(to.matchAll(FILTER_FN_RE))
  if (fromFns.length !== toFns.length || fromFns.length === 0) {
    return null
  }
  const parts = []
  for (let index = 0; index < fromFns.length; index++) {
    const fn = fromFns[index][1]
    const unit = fromFns[index][3] || ''
    if (fn !== toFns[index][1] || unit !== (toFns[index][3] || '')) {
      return null
    }
    const value =
      parseFloat(fromFns[index][2]) +
      (parseFloat(toFns[index][2]) - parseFloat(fromFns[index][2])) * p
    parts.push(fn + '(' + value + unit + ')')
  }
  return parts.join(' ')
}

const UNIT_VALUE_RE = /^(-?\d*\.?\d+)(px|%|deg|rem|em|vw|vh)$/

const interpolateUnitValue = (from, to, p) => {
  const start = UNIT_VALUE_RE.exec(from.trim())
  const end = UNIT_VALUE_RE.exec(to.trim())
  if (!start || !end || start[2] !== end[2]) {
    return null
  }
  const startAmount = parseFloat(start[1])
  return startAmount + (parseFloat(end[1]) - startAmount) * p + start[2]
}

const interpolateValue = (from, to, p) => {
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * p
  }
  if (typeof from === 'string' && typeof to === 'string') {
    const united = interpolateUnitValue(from, to, p)
    if (united !== null) {
      return united
    }
    const filter = interpolateFilter(from, to, p)
    if (filter !== null) {
      return filter
    }
  }
  return p >= 1 ? to : from
}

const applyScrollState = (element, fromVars, toVars, p) => {
  if (!element) {
    return
  }
  const keys = new Set([...Object.keys(fromVars), ...Object.keys(toVars)])
  const transformState = {}
  keys.forEach((key) => {
    const fromValue = fromVars[key] !== undefined ? fromVars[key] : toVars[key]
    const toValue = toVars[key] !== undefined ? toVars[key] : fromVars[key]
    const value = interpolateValue(fromValue, toValue, p)
    if (TRANSFORM_KEYS.includes(key)) {
      transformState[key] = value
    } else {
      element.style[key] = String(value)
    }
  })
  const transformCss = {}
  writeTransformProps(transformCss, transformState)
  Object.keys(transformCss).forEach((prop) => {
    element.style[prop] = transformCss[prop]
  })
}

const SCROLL_OFFSET_RANGES = {
  pass: ['start end', 'end start'],
  contained: ['start start', 'end end'],
  enter: ['start end', 'start start'],
  exit: ['end end', 'end start'],
}

const presetStates = (preset, distance) => {
  switch (preset) {
    case 'fade-in':
      return { from: { opacity: 0 }, to: { opacity: 1 } }
    case 'slide-up':
      return { from: { opacity: 0, y: distance }, to: { opacity: 1, y: 0 } }
    case 'slide-down':
      return { from: { opacity: 0, y: -distance }, to: { opacity: 1, y: 0 } }
    case 'slide-left':
      return { from: { opacity: 0, x: distance }, to: { opacity: 1, x: 0 } }
    case 'slide-right':
      return { from: { opacity: 0, x: -distance }, to: { opacity: 1, x: 0 } }
    case 'scale-in':
      return { from: { opacity: 0, scale: 0.8 }, to: { opacity: 1, scale: 1 } }
    case 'zoom-in':
      return { from: { opacity: 0, scale: 0.5 }, to: { opacity: 1, scale: 1 } }
    case 'pop-in':
      return { from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 } }
    case 'rotate-in':
      return { from: { opacity: 0, rotate: -8 }, to: { opacity: 1, rotate: 0 } }
    case 'tilt-in':
      return { from: { opacity: 0, rotate: -10, y: distance }, to: { opacity: 1, rotate: 0, y: 0 } }
    case 'blur-in':
      return { from: { opacity: 0, filter: 'blur(12px)' }, to: { opacity: 1, filter: 'blur(0px)' } }
    case 'blur-up':
      return {
        from: { opacity: 0, y: distance, filter: 'blur(8px)' },
        to: { opacity: 1, y: 0, filter: 'blur(0px)' },
      }
    case 'drop-in':
      return {
        from: { opacity: 0, y: -distance, scale: 1.05 },
        to: { opacity: 1, y: 0, scale: 1 },
      }
    case 'swing-in':
      return { from: { opacity: 0, rotate: -20, y: distance }, to: { opacity: 1, rotate: 0, y: 0 } }
    case 'spin-in':
      return {
        from: { opacity: 0, rotate: -180, scale: 0.6 },
        to: { opacity: 1, rotate: 0, scale: 1 },
      }
    case 'blur-zoom':
      return {
        from: { opacity: 0, scale: 1.35, filter: 'blur(10px)' },
        to: { opacity: 1, scale: 1, filter: 'blur(0px)' },
      }
    case 'zoom-out':
      return { from: { opacity: 0, scale: 1.4 }, to: { opacity: 1, scale: 1 } }
    case 'develop':
      return {
        from: { opacity: 0, filter: 'blur(6px) grayscale(1)' },
        to: { opacity: 1, filter: 'blur(0px) grayscale(0)' },
      }
    case 'glow-in':
      return {
        from: { opacity: 0, filter: 'brightness(1.8) saturate(0.4)' },
        to: { opacity: 1, filter: 'brightness(1) saturate(1)' },
      }
    case 'pulse':
      return { from: { scale: 1 }, to: { scale: 1.06 } }
    case 'float':
      return { from: { y: 0 }, to: { y: -12 } }
    case 'spin':
      return { from: { rotate: 0 }, to: { rotate: 360 } }
    case 'wobble':
      return { from: { rotate: -3 }, to: { rotate: 3 } }
    case 'none':
      return { from: {}, to: {} }
    default:
      return { from: { opacity: 0 }, to: { opacity: 1 } }
  }
}

const cssFromState = (state) => {
  const css = {}
  writeTransformProps(css, state)
  Object.keys(state).forEach((key) => {
    if (TRANSFORM_KEYS.indexOf(key) !== -1) {
      return
    }
    css[key] = state[key]
  })
  return css
}

const visibleFraction = (rect, vh, vw) => {
  const height = rect.bottom - rect.top
  const width = rect.right - rect.left
  if (height <= 0 || width <= 0) {
    return 0
  }
  const visibleHeight = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0))
  const visibleWidth = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0))
  return (visibleHeight * visibleWidth) / (height * width)
}

const reachableFraction = (rect, vh, vw) => {
  const height = rect.bottom - rect.top
  const width = rect.right - rect.left
  if (height <= 0 || width <= 0) {
    return 0
  }
  return Math.min(1, vh / height) * Math.min(1, vw / width)
}

const MARQUEE_FRAME_ATTR = 'data-marquee'
const MARQUEE_COPY_ATTR = 'data-marquee-copy'
const letMarqueeSwipe = (track) => {
  const frame = track && track.parentElement
  if (!frame || !frame.hasAttribute(MARQUEE_FRAME_ATTR)) {
    return
  }
  frame.style.overflowX = 'auto'
  track.style.minWidth = '100%'
  for (const child of Array.from(track.children)) {
    if (child.hasAttribute(MARQUEE_COPY_ATTR)) {
      child.style.display = 'none'
    }
  }
}

const READY_ATTR = 'data-motion-ready'

const isNeutral = (value, neutral) => value === undefined || Number(value) === neutral

const settleOn = (element, state) => {
  const css = cssFromState(state)
  Object.keys(css).forEach((prop) => {
    element.style[prop] = String(css[prop])
  })
  if (isNeutral(state.x, 0) && isNeutral(state.y, 0)) {
    element.style.removeProperty('translate')
  }
  if (isNeutral(state.scale, 1)) {
    element.style.removeProperty('scale')
  }
  if (isNeutral(state.rotate, 0)) {
    element.style.removeProperty('rotate')
  }
}

const keyframeFrom = (state) => {
  const css = cssFromState(state)
  const frame = {}
  Object.keys(css).forEach((prop) => {
    frame[prop] = String(css[prop])
  })
  return frame
}

const staggerTargets = (nodes, depth) => {
  if (nodes.length > 1 || depth >= 3) {
    return nodes
  }
  const only = nodes[0]
  if (only && only.children.length > 0) {
    return staggerTargets(Array.from(only.children), depth + 1)
  }
  return null
}

const initMotion = (element) => {
  const text = (name, fallback) => {
    const value = element.getAttribute('data-motion-' + name)
    return value === null || value === '' ? fallback : value
  }
  const number = (name, fallback) => {
    const parsed = Number(text(name, ''))
    return text(name, '') !== '' && Number.isFinite(parsed) ? parsed : fallback
  }
  const json = (name) => {
    try {
      const parsed = JSON.parse(text(name, 'null'))
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch (e) {
      return null
    }
  }
  const markReady = () => element.setAttribute(READY_ATTR, '')

  if (prefersReducedMotion()) {
    letMarqueeSwipe(element)
    markReady()
    return
  }

  const trigger = text('trigger', 'in-view')
  const duration = number('duration', 0.6) || 0.6
  const delay = number('delay', 0)
  const stagger = number('stagger', 0)
  const repeat = number('repeat', 0)
  const repeatCount = repeat < 0 ? Infinity : repeat
  const repeatType = text('repeat-type', 'loop')
  const once = text('in-view-once', 'true') !== 'false'
  const amount = number('in-view-amount', 0.3) || 0.3
  const base = presetStates(text('preset', 'fade-in'), number('distance', 40))
  const fromVars = Object.assign({}, base.from, json('from') || {})
  const toVars = Object.assign({}, base.to, json('to') || {})
  const ease = EASINGS[text('easing', 'ease-out')] || EASINGS['ease-out']
  const easeCss = 'cubic-bezier(' + ease.join(', ') + ')'
  const timing = {
    duration: duration * 1000,
    delay: delay * 1000,
    easing: easeCss,
    iterations: repeatCount === Infinity ? Infinity : repeatCount + 1,
    direction: repeatType === 'loop' ? 'normal' : 'alternate',
    fill: 'both',
  }

  if (trigger === 'scroll') {
    const measure = () =>
      scrollProgressForOffset(
        element.getBoundingClientRect(),
        window.innerHeight || 1,
        text('scroll-offset', 'pass')
      )
    const apply = (p) => applyScrollState(element, fromVars, toVars, p)
    apply(measure())
    followProgress(measure, number('scrub', 0), apply)
    markReady()
    return
  }

  if (trigger === 'hover' || trigger === 'tap') {
    let animation = null
    const play = (rate) => {
      if (!animation) {
        animation = element.animate([keyframeFrom(toVars)], timing)
        animation.pause()
      }
      animation.playbackRate = rate
      animation.play()
    }
    if (trigger === 'hover') {
      element.addEventListener('pointerenter', () => play(1))
      element.addEventListener('pointerleave', () => play(-1))
    } else {
      element.addEventListener('pointerdown', () => play(1))
      const release = () => play(-1)
      element.addEventListener('pointerup', release)
      element.addEventListener('pointerleave', release)
      element.addEventListener('pointercancel', release)
    }
    markReady()
    return
  }

  const targets =
    stagger > 0 && repeatCount === 0 ? staggerTargets(Array.from(element.children), 0) : null
  let enter
  let leave
  if (targets) {
    const fromCss = keyframeFrom(fromVars)
    const toCss = keyframeFrom(toVars)
    const animated = Object.keys(fromCss).concat(
      Object.keys(toCss).filter((prop) => fromCss[prop] === undefined)
    )
    const cssName = (prop) => prop.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
    const write = (css) =>
      targets.forEach((target) => {
        Object.keys(css).forEach((prop) => {
          target.style[prop] = css[prop]
        })
      })
    write(fromCss)
    targets.forEach((target, index) => {
      const delaySeconds = delay + index * stagger
      target.style.transition = animated
        .map((prop) => cssName(prop) + ' ' + duration + 's ' + easeCss + ' ' + delaySeconds + 's')
        .join(', ')
    })
    enter = () => write(toCss)
    leave = () => write(fromCss)
  } else {
    const animation = element.animate([keyframeFrom(fromVars), keyframeFrom(toVars)], timing)
    animation.pause()
    if (repeatCount === 0) {
      animation.addEventListener('finish', () => {
        if (animation.playbackRate > 0) {
          settleOn(element, toVars)
          if (once || trigger === 'load') {
            animation.cancel()
          }
        }
      })
    }
    enter = () => {
      animation.playbackRate = 1
      animation.play()
    }
    leave = () => {
      animation.playbackRate = -1
      animation.play()
    }
  }
  markReady()

  if (trigger === 'load') {
    window.requestAnimationFrame(() => enter())
    return
  }

  let revealed = false
  let frame = 0
  let observer = null
  const check = () => {
    if (once && revealed) {
      return
    }
    const rect = element.getBoundingClientRect()
    const vh = window.innerHeight || document.documentElement.clientHeight || 0
    const vw = window.innerWidth || document.documentElement.clientWidth || 0
    const fraction = visibleFraction(rect, vh, vw)
    const threshold = Math.min(amount, reachableFraction(rect, vh, vw) * 0.9)
    const visible = fraction > 0 && fraction >= threshold
    if (visible === revealed) {
      return
    }
    revealed = visible
    if (visible) {
      enter()
      if (once) {
        window.removeEventListener('scroll', schedule)
        window.removeEventListener('resize', schedule)
        if (observer) {
          observer.disconnect()
        }
      }
    } else {
      leave()
    }
  }
  const schedule = () => {
    if (frame) {
      return
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0
      check()
    })
  }
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(schedule, { threshold: [0, Math.min(1, amount)] })
    observer.observe(element)
  }
  schedule()
}

whenParsed(() => {
  document.querySelectorAll('[data-tq-motion]').forEach((element) => {
    try {
      initMotion(element)
    } catch (e) {
      element.setAttribute(READY_ATTR, '')
    }
  })
})
})()
