/**
 * iOS gates motion sensors behind a permission prompt that must be triggered from a user
 * gesture. Call this synchronously from the "View in AR" tap, before any other await.
 */
export async function requestMotionPermission(): Promise<'granted' | 'denied' | 'not-required'> {
  type PermissionFn = () => Promise<'granted' | 'denied'>
  const motion = (window.DeviceMotionEvent as unknown as { requestPermission?: PermissionFn }) ?? {}
  const orientation = (window.DeviceOrientationEvent as unknown as { requestPermission?: PermissionFn }) ?? {}
  if (typeof motion.requestPermission !== 'function') return 'not-required'
  try {
    const results = await Promise.all([
      motion.requestPermission(),
      typeof orientation.requestPermission === 'function' ? orientation.requestPermission() : 'granted',
    ])
    return results.every((r) => r === 'granted') ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}
